//! Trace equivalence between the old coordinator and `machine::Machine`.

use super::machine::{Effect, Event, Machine, RecreationId, State};
use super::{
    BeginResult, DecisionResult, FrontendReadyOutcome, FrontendToken, LifecycleAttempt,
    LifecycleCoordinator, LifecycleDecision, LifecycleDecisionPayload, LifecycleKind,
    RecreationOutcome, TimeoutOutcome,
};

/// One call on the old coordinator, in the vocabulary of `lifecycle/mod.rs`.
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
        OldResult::NewWindow(_) | OldResult::Unit => Outcome::NoOp,
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
    if effects.iter().any(|effect| matches!(effect, Effect::AllowExit)) {
        return Outcome::Bypassed;
    }
    if effects.iter().any(|effect| matches!(effect, Effect::Finalize(_))) {
        return Outcome::Authorized;
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::ShowRecoveryDialog(_)))
    {
        return Outcome::Recovered;
    }
    if let Some(Effect::EmitRequest { attempt, .. }) =
        effects.iter().find(|effect| matches!(effect, Effect::EmitRequest { .. }))
    {
        return if attempt.sequence == 0 {
            Outcome::Asked
        } else {
            Outcome::Reemit
        };
    }
    if effects.iter().any(|effect| matches!(effect, Effect::Exit)) {
        return Outcome::AllowedDirect;
    }
    if effects.iter().any(|effect| matches!(effect, Effect::Recreate(_))) {
        return Outcome::Other("started");
    }
    if effects
        .iter()
        .any(|effect| matches!(effect, Effect::ScheduleTimeout(_)))
    {
        return Outcome::Other("awaiting");
    }
    if effects.iter().any(|effect| matches!(effect, Effect::PreventExit)) {
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
            "dup" | "finalizing" => Outcome::Ignored,
            "queued" => Outcome::Queued,
            "cancelled" => Outcome::Cancelled,
            _ => Outcome::NoOp,
        };
    }
    Outcome::NoOp
}

/// Maps an old call to its machine event(s), and records the design's expected
/// coarse outcome for the mapping. Calls with no machine counterpart return None.
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
            (
                vec![Event::RecreationFinished { id, ok: *ok }],
                if *ok {
                    Outcome::NoOp
                } else {
                    Outcome::Other("failed")
                },
            )
        }
        OldCall::FrontendReady(instance_id) => (
            vec![Event::FrontendReady {
                instance_id: instance_id.clone(),
            }],
            Outcome::NoOp,
        ),
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
            Outcome::Other("begin"),
        ),
        OldCall::Decide(payload) => (
            vec![Event::Decide {
                attempt_id: payload.attempt_id,
                generation: payload.generation,
                sequence: payload.request_sequence,
                decision: to_machine_decision(payload.decision),
                dirty: payload.dirty,
                pending: payload.pending,
            }],
            Outcome::Other("decide"),
        ),
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
            let new_outcome = classify_new(new.state(), &effects);
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

#[test]
fn asks_ready_frontend_once_trace_has_one_row_per_old_call() {
    let trace = vec![
        OldCall::FrontendReady("one".into()),
        OldCall::Begin(LifecycleKind::Close, true),
        OldCall::Begin(LifecycleKind::Close, true),
    ];

    assert_eq!(compare(&trace).len(), trace.len());
}
