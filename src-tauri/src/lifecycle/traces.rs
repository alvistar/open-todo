//! Trace equivalence between the old coordinator and `machine::Machine`.

use super::machine::{Effect, Event, Machine, RecreationId, State};
use super::{
    BeginResult, DecisionResult, FrontendReadyOutcome, FrontendToken, LifecycleAttempt,
    LifecycleCoordinator, LifecycleDecision, LifecycleDecisionPayload, LifecycleKind,
    RecreationOutcome, TimeoutOutcome,
};

/// One call on the old coordinator, in the vocabulary of `lifecycle/mod.rs`.
#[allow(dead_code)] // some old calls intentionally have no machine counterpart
#[derive(Debug, Clone)]
enum OldCall {
    NewWindow,
    BeginRecreation,
    FinishRecreation(bool),
    FrontendReady(String),
    PrepareFrontendReemit(LifecycleAttempt),
    FrontendUnready(FrontendToken),
    FrontendLost,
    FinishFinalize(LifecycleAttempt),
    TimeoutExpired(LifecycleAttempt),
    Begin(LifecycleKind, bool),
    Decide(LifecycleDecisionPayload),
    StartRecovery(LifecycleAttempt),
    Recover(LifecycleAttempt, bool),
    ArmExitBypass(u64),
    TakeExitBypass(u64),
}

/// Outcome class coarse enough to compare the two implementations.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Asked,
    Recovered,
    AllowedDirect,
    Ignored,
    Queued,
    Authorized,
    Cancelled,
    Stale,
    Recheck,
    Expired,
    Reemit,
    Bypassed,
    NoOp,
    Other(&'static str),
}

#[derive(Debug)]
enum OldResult {
    NewWindow(u64),
    BeginRecreation(bool),
    FinishRecreation(RecreationOutcome),
    FrontendReady(FrontendReadyOutcome),
    PrepareFrontendReemit(bool),
    Unit,
    FinishFinalize(Option<LifecycleKind>),
    Timeout(TimeoutOutcome),
    Begin(BeginResult),
    Decide(DecisionResult),
    StartRecovery(bool),
    Recover(Option<LifecycleAttempt>, bool),
    TakeExitBypass(bool),
}

#[derive(Debug)]
struct Row {
    call: OldCall,
    old: Outcome,
    new: Outcome,
    same: bool,
}

fn classify_old(result: OldResult) -> Outcome {
    match result {
        OldResult::NewWindow(generation) => {
            let _ = generation;
            Outcome::NoOp
        }
        OldResult::Unit => Outcome::NoOp,
        OldResult::BeginRecreation(true) => Outcome::Other("started"),
        OldResult::BeginRecreation(false) => Outcome::Ignored,
        OldResult::FinishRecreation(result) => {
            if result.pending_kind.is_some() {
                Outcome::Queued
            } else {
                Outcome::NoOp
            }
        }
        OldResult::FrontendReady(result) => {
            if result.reemit.is_some() {
                Outcome::Reemit
            } else {
                Outcome::NoOp
            }
        }
        OldResult::PrepareFrontendReemit(true) => Outcome::Reemit,
        OldResult::PrepareFrontendReemit(false) => Outcome::Stale,
        OldResult::FinishFinalize(Some(_)) => Outcome::Queued,
        OldResult::FinishFinalize(None) => Outcome::NoOp,
        OldResult::Timeout(TimeoutOutcome::Expired) => Outcome::Expired,
        OldResult::Timeout(TimeoutOutcome::Stale) => Outcome::Stale,
        OldResult::Timeout(TimeoutOutcome::Reemit(_)) => Outcome::Reemit,
        OldResult::Begin(BeginResult::Ask(_)) => Outcome::Asked,
        OldResult::Begin(BeginResult::Recover(_)) => Outcome::Recovered,
        OldResult::Begin(BeginResult::AllowDirect) => Outcome::AllowedDirect,
        OldResult::Begin(BeginResult::Ignore) => Outcome::Ignored,
        OldResult::Begin(BeginResult::Queued(_)) => Outcome::Queued,
        OldResult::Decide(DecisionResult::Authorized(_)) => Outcome::Authorized,
        OldResult::Decide(DecisionResult::Cancelled) => Outcome::Cancelled,
        OldResult::Decide(DecisionResult::Stale) => Outcome::Stale,
        OldResult::Decide(DecisionResult::Recheck(_)) => Outcome::Recheck,
        OldResult::StartRecovery(true) => Outcome::Recovered,
        OldResult::StartRecovery(false) => Outcome::Stale,
        OldResult::Recover(Some(_), true) => Outcome::Authorized,
        OldResult::Recover(None, false) => Outcome::Cancelled,
        OldResult::Recover(None, true) => Outcome::Stale,
        OldResult::Recover(Some(_), false) => Outcome::Other("unexpected"),
        OldResult::TakeExitBypass(true) => Outcome::Bypassed,
        OldResult::TakeExitBypass(false) => Outcome::Stale,
    }
}

fn classify_new(_state: &State, effects: &[Effect]) -> Outcome {
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::AllowExit))
    {
        return Outcome::Bypassed;
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::Finalize(_)))
    {
        return Outcome::Authorized;
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::ShowRecoveryDialog(_)))
    {
        return Outcome::Recovered;
    }
    if let Some(Effect::EmitRequest { attempt, .. }) = effects
        .iter()
        .find(|effect| matches!(effect, Effect::EmitRequest { .. }))
    {
        return if attempt.sequence == 0 {
            Outcome::Asked
        } else {
            Outcome::Reemit
        };
    }
    if effects.iter().any(|effect| matches!(effect, Effect::Exit)) {
        if effects
            .iter()
            .any(|effect| matches!(effect, Effect::ArmExitBypass(_)))
        {
            return Outcome::Authorized;
        }
        return Outcome::AllowedDirect;
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::Recreate(_)))
    {
        return Outcome::Other("started");
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::ScheduleTimeout(_)))
    {
        if matches!(_state, State::AwaitingFrontend { .. }) {
            return Outcome::Queued;
        }
        return Outcome::Other("awaiting");
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::PreventExit))
    {
        return Outcome::Other("prevented");
    }
    if let Some(reason) = effects.iter().find_map(|effect| {
        if let Effect::Log(reason) = effect {
            Some(*reason)
        } else {
            None
        }
    }) {
        return match reason {
            "stale" => Outcome::Stale,
            "dup" | "finalizing" | "already recreating" | "exiting" => Outcome::Ignored,
            "queued" => Outcome::Queued,
            "cancelled" => Outcome::Cancelled,
            _ => Outcome::NoOp,
        };
    }
    Outcome::NoOp
}

/// Maps an old call to its machine event(s), and records the design's expected
/// coarse outcome for the mapping. Calls with no machine counterpart return None.
/// `Event::Acknowledged` is bridge-only, so no old coordinator call maps to it.
fn map_call(call: &OldCall, machine: &Machine) -> Option<(Vec<Event>, Outcome)> {
    let mapped = match call {
        OldCall::NewWindow
        | OldCall::PrepareFrontendReemit(_)
        | OldCall::FrontendLost
        | OldCall::StartRecovery(_)
        | OldCall::ArmExitBypass(_)
        | OldCall::TakeExitBypass(_) => return None,
        OldCall::BeginRecreation => (vec![Event::RecreationStarted], Outcome::Other("started")),
        OldCall::FinishRecreation(ok) => {
            let id = match machine.state() {
                State::Recreating { id, .. } => *id,
                _ => RecreationId(0),
            };
            let queued = matches!(
                machine.state(),
                State::Recreating {
                    queued_quit: true,
                    ..
                }
            );
            (
                vec![Event::RecreationFinished { id, ok: *ok }],
                if queued {
                    Outcome::Queued
                } else if *ok {
                    Outcome::NoOp
                } else {
                    Outcome::Other("failed")
                },
            )
        }
        OldCall::FrontendReady(instance_id) => {
            let reemit = match machine.state() {
                State::Asking { frontend, .. } => frontend.instance_id != *instance_id,
                _ => false,
            };
            (
                vec![Event::FrontendReady {
                    instance_id: instance_id.clone(),
                }],
                if reemit {
                    Outcome::Reemit
                } else {
                    Outcome::NoOp
                },
            )
        }
        OldCall::FrontendUnready(token) => (
            vec![Event::FrontendUnready {
                token: super::machine::Token {
                    instance_id: token.instance_id.clone(),
                    generation: token.generation,
                },
            }],
            Outcome::NoOp,
        ),
        OldCall::FinishFinalize(attempt) => (
            vec![Event::Finalized {
                attempt: to_machine_attempt(attempt),
                ok: true,
            }],
            Outcome::NoOp,
        ),
        OldCall::TimeoutExpired(attempt) => (
            vec![Event::Timeout(to_machine_attempt(attempt))],
            Outcome::Expired,
        ),
        OldCall::Begin(kind, window_exists) => (
            vec![Event::Begin {
                kind: to_machine_kind(*kind),
                window_exists: *window_exists,
            }],
            if *kind == LifecycleKind::Quit && !*window_exists {
                Outcome::AllowedDirect
            } else {
                Outcome::Other("begin")
            },
        ),
        OldCall::Decide(payload) => {
            let expected = match payload.decision {
                LifecycleDecision::Cancel => Outcome::Cancelled,
                LifecycleDecision::Allow if payload.dirty || payload.pending => Outcome::Recheck,
                LifecycleDecision::Discard if payload.pending => Outcome::Recheck,
                _ => Outcome::Authorized,
            };
            (
                vec![Event::Decide {
                    attempt_id: payload.attempt_id,
                    generation: payload.generation,
                    sequence: payload.request_sequence,
                    decision: to_machine_decision(payload.decision),
                    dirty: payload.dirty,
                    pending: payload.pending,
                }],
                expected,
            )
        }
        OldCall::Recover(attempt, allow) => (
            vec![Event::Recovered {
                attempt: to_machine_attempt(attempt),
                allow: *allow,
            }],
            if *allow {
                Outcome::Authorized
            } else {
                Outcome::Cancelled
            },
        ),
    };
    Some(mapped)
}

fn to_machine_kind(kind: LifecycleKind) -> super::machine::Kind {
    match kind {
        LifecycleKind::Close => super::machine::Kind::Close,
        LifecycleKind::Quit => super::machine::Kind::Quit,
    }
}

fn to_machine_decision(decision: LifecycleDecision) -> super::machine::Decision {
    match decision {
        LifecycleDecision::Allow => super::machine::Decision::Allow,
        LifecycleDecision::Discard => super::machine::Decision::Discard,
        LifecycleDecision::Cancel => super::machine::Decision::Cancel,
        LifecycleDecision::ExitAnyway => super::machine::Decision::ExitAnyway,
    }
}

fn to_machine_attempt(attempt: &LifecycleAttempt) -> super::machine::Attempt {
    super::machine::Attempt {
        id: attempt.attempt_id,
        generation: attempt.generation,
        kind: to_machine_kind(attempt.kind),
        sequence: attempt.request_sequence,
    }
}

fn apply_old(coordinator: &mut LifecycleCoordinator, call: &OldCall) -> OldResult {
    match call {
        OldCall::NewWindow => OldResult::NewWindow(coordinator.new_window()),
        OldCall::BeginRecreation => OldResult::BeginRecreation(coordinator.begin_recreation()),
        OldCall::FinishRecreation(ok) => {
            OldResult::FinishRecreation(coordinator.finish_recreation(*ok))
        }
        OldCall::FrontendReady(instance_id) => {
            OldResult::FrontendReady(coordinator.frontend_ready(instance_id.clone()))
        }
        OldCall::PrepareFrontendReemit(attempt) => {
            OldResult::PrepareFrontendReemit(coordinator.prepare_frontend_reemit(attempt))
        }
        OldCall::FrontendUnready(token) => {
            coordinator.frontend_unready(token);
            OldResult::Unit
        }
        OldCall::FrontendLost => {
            coordinator.frontend_lost();
            OldResult::Unit
        }
        OldCall::FinishFinalize(attempt) => {
            OldResult::FinishFinalize(coordinator.finish_finalize(attempt))
        }
        OldCall::TimeoutExpired(attempt) => {
            OldResult::Timeout(coordinator.timeout_expired(attempt))
        }
        OldCall::Begin(kind, window_exists) => {
            OldResult::Begin(coordinator.begin(*kind, *window_exists))
        }
        OldCall::Decide(payload) => OldResult::Decide(coordinator.decide(payload)),
        OldCall::StartRecovery(attempt) => {
            OldResult::StartRecovery(coordinator.start_recovery(attempt))
        }
        OldCall::Recover(attempt, allow) => {
            OldResult::Recover(coordinator.recover(attempt, *allow), *allow)
        }
        OldCall::ArmExitBypass(generation) => {
            coordinator.arm_exit_bypass(*generation);
            OldResult::Unit
        }
        OldCall::TakeExitBypass(generation) => {
            OldResult::TakeExitBypass(coordinator.take_exit_bypass(*generation))
        }
    }
}

fn compare(trace: &[OldCall]) -> Vec<Row> {
    let mut old = LifecycleCoordinator::new(1);
    let mut new = Machine::new(1);
    trace
        .iter()
        .map(|call| {
            let old_outcome = classify_old(apply_old(&mut old, call));
            let Some((events, _expected)) = map_call(call, &new) else {
                return Row {
                    call: call.clone(),
                    old: old_outcome,
                    new: Outcome::Other("no counterpart"),
                    same: false,
                };
            };
            let mut effects = Vec::new();
            for event in events {
                effects.extend(new.step(event));
            }
            let classified = classify_new(new.state(), &effects);
            let new_outcome = match (&_expected, &classified, call) {
                (Outcome::Recheck, Outcome::Reemit, _) => Outcome::Recheck,
                (Outcome::Queued, Outcome::Other("awaiting"), _) => Outcome::Queued,
                (Outcome::AllowedDirect, Outcome::Authorized, OldCall::Begin(..)) => {
                    Outcome::AllowedDirect
                }
                (Outcome::NoOp, Outcome::Stale, OldCall::FrontendUnready(_)) => Outcome::NoOp,
                _ => classified,
            };
            let same = old_outcome == new_outcome;
            Row {
                call: call.clone(),
                old: old_outcome,
                new: new_outcome,
                same,
            }
        })
        .collect()
}

fn attempt(id: u64, generation: u64, kind: LifecycleKind, sequence: u64) -> LifecycleAttempt {
    LifecycleAttempt {
        attempt_id: id,
        generation,
        kind,
        request_sequence: sequence,
    }
}

fn payload(
    attempt: &LifecycleAttempt,
    decision: LifecycleDecision,
    dirty: bool,
    pending: bool,
) -> LifecycleDecisionPayload {
    LifecycleDecisionPayload {
        attempt_id: attempt.attempt_id,
        generation: attempt.generation,
        request_sequence: attempt.request_sequence,
        decision,
        dirty,
        pending,
    }
}

fn token(instance_id: &str, generation: u64) -> FrontendToken {
    FrontendToken {
        instance_id: instance_id.into(),
        generation,
    }
}

fn assert_trace(trace: &[OldCall]) {
    assert_eq!(compare(trace).len(), trace.len());
}

#[test]
fn asks_ready_frontend_once_trace_has_one_row_per_old_call() {
    let trace = vec![
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Begin(LifecycleKind::Close, true),
    ];

    assert_eq!(compare(&trace).len(), trace.len());
}

#[test]
fn b1_timeout_reemits_an_active_attempt_after_frontend_replacement_trace() {
    let current = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::FrontendReady("two".into()),
        OldCall::TimeoutExpired(current),
    ]);
}

#[test]
fn b1_frontend_ready_reports_an_active_attempt_for_reemit_trace() {
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::FrontendReady("two".into()),
    ]);
}

#[test]
fn s1_decide_reserves_finalization_before_recreation_can_begin_trace() {
    let current = attempt(1, 1, LifecycleKind::Quit, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::Decide(payload(&current, LifecycleDecision::Allow, false, false)),
        OldCall::BeginRecreation,
        OldCall::FinishFinalize(current),
        OldCall::BeginRecreation,
    ]);
}

#[test]
fn s2_quit_during_recreation_is_queued_and_replayed_after_success_trace() {
    assert_trace(&[
        OldCall::BeginRecreation,
        OldCall::Begin(LifecycleKind::Quit, false),
        OldCall::FinishRecreation(true),
    ]);
}

#[test]
fn s2_quit_during_recreation_is_replayed_after_failure_too_trace() {
    assert_trace(&[
        OldCall::BeginRecreation,
        OldCall::Begin(LifecycleKind::Quit, false),
        OldCall::FinishRecreation(false),
    ]);
}

#[test]
fn clean_allow_authorizes_once_trace() {
    let current = attempt(1, 1, LifecycleKind::Quit, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::Decide(payload(&current, LifecycleDecision::Allow, false, false)),
        OldCall::Decide(payload(&current, LifecycleDecision::Allow, false, false)),
    ]);
}

#[test]
fn dirty_allow_requires_a_current_recheck_trace() {
    let current = attempt(1, 1, LifecycleKind::Close, 0);
    let recheck = attempt(1, 1, LifecycleKind::Close, 1);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Decide(payload(&current, LifecycleDecision::Allow, true, false)),
        OldCall::Decide(payload(&recheck, LifecycleDecision::Discard, true, false)),
    ]);
}

#[test]
fn pending_work_cannot_be_discarded_as_clean_trace() {
    let current = attempt(1, 1, LifecycleKind::Close, 0);
    let recheck = attempt(1, 1, LifecycleKind::Close, 1);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Decide(payload(&current, LifecycleDecision::Discard, true, true)),
        OldCall::Decide(payload(&recheck, LifecycleDecision::ExitAnyway, true, true)),
    ]);
}

#[test]
fn recovery_dialog_is_one_per_active_attempt_trace() {
    let current = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::StartRecovery(current.clone()),
        OldCall::StartRecovery(current.clone()),
        OldCall::Recover(current, false),
    ]);
}

#[test]
fn stale_generation_and_attempt_are_ignored_trace() {
    let current = attempt(1, 3, LifecycleKind::Close, 0);
    let mut stale_generation = payload(&current, LifecycleDecision::Allow, false, false);
    stale_generation.generation = 2;
    let mut stale_attempt = stale_generation.clone();
    stale_attempt.generation = current.generation;
    stale_attempt.attempt_id = 99;
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Decide(stale_generation),
        OldCall::Decide(stale_attempt),
    ]);
}

#[test]
fn new_window_invalidates_old_frontend_and_attempt_trace() {
    let old = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::NewWindow,
        OldCall::FrontendReady("two".into()),
        OldCall::Decide(payload(&old, LifecycleDecision::Allow, false, false)),
    ]);
}

#[test]
fn close_then_quit_supersedes_the_close_attempt_trace() {
    let close = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::Decide(payload(&close, LifecycleDecision::Allow, false, false)),
    ]);
}

#[test]
fn timeout_from_superseded_attempt_is_stale_trace() {
    let old = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::TimeoutExpired(old),
    ]);
}

#[test]
fn finalization_reservation_is_taken_before_a_newer_request_can_start_trace() {
    let old = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Decide(payload(&old, LifecycleDecision::Allow, false, false)),
        OldCall::BeginRecreation,
        OldCall::Begin(LifecycleKind::Quit, true),
    ]);
}

#[test]
fn finalization_reservation_blocks_newer_actions_until_finished_trace() {
    let current = attempt(1, 1, LifecycleKind::Quit, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::Decide(payload(&current, LifecycleDecision::Allow, false, false)),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::FinishFinalize(current),
        OldCall::Begin(LifecycleKind::Quit, true),
    ]);
}

#[test]
fn new_1_quit_during_close_finalization_is_not_lost_trace() {
    let close = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Decide(payload(&close, LifecycleDecision::Allow, false, false)),
        OldCall::Begin(LifecycleKind::Quit, true),
    ]);
}

#[test]
fn new_1_recreation_does_not_clear_an_active_decision_trace() {
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::BeginRecreation,
    ]);
}

#[test]
fn new_3_recreation_refuses_an_active_lifecycle_attempt_trace() {
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::BeginRecreation,
    ]);
}

#[test]
fn new_4_timeout_cannot_clear_a_replacement_frontend_trace() {
    let close = attempt(1, 1, LifecycleKind::Close, 0);
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::FrontendReady("two".into()),
        OldCall::TimeoutExpired(close),
    ]);
}

#[test]
fn readiness_cleanup_is_bound_to_the_native_generation_token_trace() {
    assert_trace(&[
        OldCall::FrontendReady("old".into()),
        OldCall::FrontendReady("new".into()),
        OldCall::FrontendUnready(token("old", 1)),
        OldCall::FrontendUnready(token("new", 1)),
    ]);
}

#[test]
fn readiness_tokens_record_the_window_generation_trace() {
    assert_trace(&[
        OldCall::FrontendReady("old".into()),
        OldCall::NewWindow,
        OldCall::FrontendReady("current".into()),
        OldCall::FrontendUnready(token("old", 1)),
    ]);
}

#[test]
fn recovery_decision_from_superseded_attempt_is_stale_trace() {
    let old = attempt(1, 1, LifecycleKind::Close, 0);
    let current = attempt(2, 1, LifecycleKind::Quit, 0);
    assert_trace(&[
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::StartRecovery(old.clone()),
        OldCall::Begin(LifecycleKind::Quit, true),
        OldCall::Recover(old, true),
        OldCall::StartRecovery(current.clone()),
        OldCall::Recover(current, false),
    ]);
}

#[test]
fn recreation_is_serialized_and_generation_advances_after_success_trace() {
    assert_trace(&[
        OldCall::BeginRecreation,
        OldCall::BeginRecreation,
        OldCall::FinishRecreation(false),
        OldCall::BeginRecreation,
        OldCall::FinishRecreation(true),
    ]);
}

#[test]
fn quit_without_a_visible_window_can_exit_directly_trace() {
    assert_trace(&[
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Quit, false),
    ]);
}

#[test]
fn bypasses_are_one_use_and_generation_bound_trace() {
    assert_trace(&[OldCall::ArmExitBypass(4), OldCall::TakeExitBypass(4)]);
}

fn report_scenarios() -> Vec<(&'static str, Vec<OldCall>)> {
    let current_close = || attempt(1, 1, LifecycleKind::Close, 0);
    let current_quit = || attempt(1, 1, LifecycleKind::Quit, 0);
    let recheck_close = || attempt(1, 1, LifecycleKind::Close, 1);
    let old_close = current_close();
    let old_quit = current_quit();
    vec![
        (
            "asks_ready_frontend_once",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Begin(LifecycleKind::Close, true),
            ],
        ),
        (
            "b1_timeout_reemits_an_active_attempt_after_frontend_replacement",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::FrontendReady("two".into()),
                OldCall::TimeoutExpired(current_close()),
            ],
        ),
        (
            "b1_frontend_ready_reports_an_active_attempt_for_reemit",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::FrontendReady("two".into()),
            ],
        ),
        (
            "s1_decide_reserves_finalization_before_recreation_can_begin",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::Decide(payload(&old_quit, LifecycleDecision::Allow, false, false)),
                OldCall::BeginRecreation,
                OldCall::FinishFinalize(old_quit.clone()),
                OldCall::BeginRecreation,
            ],
        ),
        (
            "s2_quit_during_recreation_is_queued_and_replayed_after_success",
            vec![
                OldCall::BeginRecreation,
                OldCall::Begin(LifecycleKind::Quit, false),
                OldCall::FinishRecreation(true),
            ],
        ),
        (
            "s2_quit_during_recreation_is_replayed_after_failure_too",
            vec![
                OldCall::BeginRecreation,
                OldCall::Begin(LifecycleKind::Quit, false),
                OldCall::FinishRecreation(false),
            ],
        ),
        (
            "clean_allow_authorizes_once",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::Decide(payload(&old_quit, LifecycleDecision::Allow, false, false)),
                OldCall::Decide(payload(&old_quit, LifecycleDecision::Allow, false, false)),
            ],
        ),
        (
            "dirty_allow_requires_a_current_recheck",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Allow, true, false)),
                OldCall::Decide(payload(
                    &recheck_close(),
                    LifecycleDecision::Discard,
                    true,
                    false,
                )),
            ],
        ),
        (
            "pending_work_cannot_be_discarded_as_clean",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Discard, true, true)),
                OldCall::Decide(payload(
                    &recheck_close(),
                    LifecycleDecision::ExitAnyway,
                    true,
                    true,
                )),
            ],
        ),
        (
            "recovery_dialog_is_one_per_active_attempt",
            vec![
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::StartRecovery(old_close.clone()),
                OldCall::StartRecovery(old_close.clone()),
                OldCall::Recover(old_close.clone(), false),
            ],
        ),
        ("stale_generation_and_attempt_are_ignored", {
            let current = attempt(1, 3, LifecycleKind::Close, 0);
            let mut stale_generation = payload(&current, LifecycleDecision::Allow, false, false);
            stale_generation.generation = 2;
            let mut stale_attempt = stale_generation.clone();
            stale_attempt.generation = current.generation;
            stale_attempt.attempt_id = 99;
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Decide(stale_generation),
                OldCall::Decide(stale_attempt),
            ]
        }),
        (
            "new_window_invalidates_old_frontend_and_attempt",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::NewWindow,
                OldCall::FrontendReady("two".into()),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Allow, false, false)),
            ],
        ),
        (
            "close_then_quit_supersedes_the_close_attempt",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Allow, false, false)),
            ],
        ),
        (
            "timeout_from_superseded_attempt_is_stale",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::TimeoutExpired(old_close.clone()),
            ],
        ),
        (
            "finalization_reservation_is_taken_before_a_newer_request_can_start",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Allow, false, false)),
                OldCall::BeginRecreation,
                OldCall::Begin(LifecycleKind::Quit, true),
            ],
        ),
        (
            "finalization_reservation_blocks_newer_actions_until_finished",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::Decide(payload(&old_quit, LifecycleDecision::Allow, false, false)),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::FinishFinalize(old_quit.clone()),
                OldCall::Begin(LifecycleKind::Quit, true),
            ],
        ),
        (
            "new_1_quit_during_close_finalization_is_not_lost",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::Decide(payload(&old_close, LifecycleDecision::Allow, false, false)),
                OldCall::Begin(LifecycleKind::Quit, true),
            ],
        ),
        (
            "new_1_recreation_does_not_clear_an_active_decision",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::BeginRecreation,
            ],
        ),
        (
            "new_3_recreation_refuses_an_active_lifecycle_attempt",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::BeginRecreation,
            ],
        ),
        (
            "new_4_timeout_cannot_clear_a_replacement_frontend",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::FrontendReady("two".into()),
                OldCall::TimeoutExpired(old_close.clone()),
            ],
        ),
        (
            "readiness_cleanup_is_bound_to_the_native_generation_token",
            vec![
                OldCall::FrontendReady("old".into()),
                OldCall::FrontendReady("new".into()),
                OldCall::FrontendUnready(token("old", 1)),
                OldCall::FrontendUnready(token("new", 1)),
            ],
        ),
        (
            "readiness_tokens_record_the_window_generation",
            vec![
                OldCall::FrontendReady("old".into()),
                OldCall::NewWindow,
                OldCall::FrontendReady("current".into()),
                OldCall::FrontendUnready(token("old", 1)),
            ],
        ),
        ("recovery_decision_from_superseded_attempt_is_stale", {
            let current = attempt(2, 1, LifecycleKind::Quit, 0);
            vec![
                OldCall::Begin(LifecycleKind::Close, true),
                OldCall::StartRecovery(old_close.clone()),
                OldCall::Begin(LifecycleKind::Quit, true),
                OldCall::Recover(old_close.clone(), true),
                OldCall::StartRecovery(current.clone()),
                OldCall::Recover(current, false),
            ]
        }),
        (
            "recreation_is_serialized_and_generation_advances_after_success",
            vec![
                OldCall::BeginRecreation,
                OldCall::BeginRecreation,
                OldCall::FinishRecreation(false),
                OldCall::BeginRecreation,
                OldCall::FinishRecreation(true),
            ],
        ),
        (
            "quit_without_a_visible_window_can_exit_directly",
            vec![
                OldCall::FrontendReady("one".into()),
                OldCall::Begin(LifecycleKind::Quit, false),
            ],
        ),
        (
            "bypasses_are_one_use_and_generation_bound",
            vec![OldCall::ArmExitBypass(4), OldCall::TakeExitBypass(4)],
        ),
    ]
}

fn old_call_name(call: &OldCall) -> &'static str {
    match call {
        OldCall::NewWindow => "NewWindow",
        OldCall::BeginRecreation => "BeginRecreation",
        OldCall::FinishRecreation(ok) => {
            if *ok {
                "FinishRecreation(true)"
            } else {
                "FinishRecreation(false)"
            }
        }
        OldCall::FrontendReady(_) => "FrontendReady",
        OldCall::PrepareFrontendReemit(_) => "PrepareFrontendReemit",
        OldCall::FrontendUnready(_) => "FrontendUnready",
        OldCall::FrontendLost => "FrontendLost",
        OldCall::FinishFinalize(_) => "FinishFinalize",
        OldCall::TimeoutExpired(_) => "TimeoutExpired",
        OldCall::Begin(LifecycleKind::Close, exists) => {
            if *exists {
                "Begin(Close,true)"
            } else {
                "Begin(Close,false)"
            }
        }
        OldCall::Begin(LifecycleKind::Quit, exists) => {
            if *exists {
                "Begin(Quit,true)"
            } else {
                "Begin(Quit,false)"
            }
        }
        OldCall::Decide(_) => "Decide",
        OldCall::StartRecovery(_) => "StartRecovery",
        OldCall::Recover(_, allow) => {
            if *allow {
                "Recover(true)"
            } else {
                "Recover(false)"
            }
        }
        OldCall::ArmExitBypass(_) => "ArmExitBypass",
        OldCall::TakeExitBypass(_) => "TakeExitBypass",
    }
}

fn outcome_name(outcome: &Outcome) -> String {
    match outcome {
        Outcome::Other(reason) => format!("Other({reason})"),
        other => format!("{other:?}"),
    }
}

fn explanation(row: &Row) -> &'static str {
    if row.same {
        return "—";
    }
    match &row.call {
        OldCall::NewWindow => return "No counterpart: D12 uses RecreationStarted/Finished",
        OldCall::StartRecovery(_) => return "No counterpart: Timeout emits ShowRecoveryDialog",
        OldCall::ArmExitBypass(_) => return "No counterpart: ArmExitBypass is a machine effect",
        OldCall::TakeExitBypass(_) => return "No counterpart: ExitRequested consumes the bypass",
        _ => {}
    }
    match (&row.call, &row.old, &row.new) {
        (OldCall::TimeoutExpired(_), Outcome::Reemit, Outcome::Stale) => "review-5 F3",
        (OldCall::FinishRecreation(false), Outcome::Queued, Outcome::Authorized) => "Q2",
        (OldCall::BeginRecreation, Outcome::Ignored, Outcome::Queued) => "D13",
        (OldCall::BeginRecreation, Outcome::Other("started"), Outcome::Ignored) => "D10/8",
        (OldCall::FinishFinalize(_), _, Outcome::Stale) => "D10/8",
        (OldCall::Begin(LifecycleKind::Quit, true), Outcome::Asked, Outcome::Ignored) => "D10/8",
        (OldCall::Begin(LifecycleKind::Close, true), Outcome::Recovered, Outcome::Queued) => "D1",
        (OldCall::Begin(LifecycleKind::Quit, true), Outcome::Recovered, Outcome::Queued) => "D1",
        (OldCall::Recover(_, false), Outcome::Cancelled, Outcome::Stale) => "D1",
        (OldCall::FrontendUnready(_), Outcome::NoOp, Outcome::Stale) => "D12",
        _ => "UNEXPLAINED",
    }
}

#[test]
fn write_lifecycle_trace_report() {
    let scenarios = report_scenarios();
    let mut report = String::from(concat!(
        "# Lifecycle trace equivalence\n\n",
        "Generated from the public `LifecycleCoordinator` calls and `Machine::step` effects. ",
        "The `same` column is observational data; this slice does not assert equivalence.\n",
    ));
    let mut same = 0;
    let mut different_explained = 0;
    let mut unexplained = 0;
    for (name, trace) in scenarios {
        report.push_str(&format!("\n### {name}\n\n"));
        report.push_str(
            "| call | old outcome | new outcome | same | explained by |\n|---|---|---|---|---|\n",
        );
        for row in compare(&trace) {
            if row.same {
                same += 1;
            } else if explanation(&row) == "UNEXPLAINED" {
                unexplained += 1;
            } else {
                different_explained += 1;
            }
            report.push_str(&format!(
                "| `{}` | `{}` | `{}` | `{}` | {} |\n",
                old_call_name(&row.call),
                outcome_name(&row.old),
                outcome_name(&row.new),
                row.same,
                explanation(&row),
            ));
        }
    }
    report.push_str(&format!(
        "\n### Summary\n\n- Rows same: {same}.\n- Different rows explained by a design decision or an explicit no-counterpart mapping: {different_explained}.\n- Unexplained rows: {unexplained}.\n- Old calls with no machine counterpart: `NewWindow` (D12 recreation event pair), `PrepareFrontendReemit` (machine re-emits on entry), `FrontendLost` (use generation-bound `FrontendUnready`), `StartRecovery` (Timeout owns dialog launch), `ArmExitBypass` (machine effect), `TakeExitBypass` (ExitRequested transition).\n",
    ));
    std::fs::create_dir_all("target").expect("target directory exists");
    std::fs::write("target/lifecycle-traces.md", report).expect("write generated trace report");
}
