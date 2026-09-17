//! Property tests for `machine::Machine::step`.

use super::machine::*;
use proptest::prelude::*;
use std::collections::BTreeMap;

const MAX_TRACE_LEN: usize = 40;

/// Build one event from a seed and the public state carried by `machine`.
///
/// Even-numbered branches prefer the owner currently carried by the state;
/// odd-numbered branches deliberately perturb one owner field.  The fallback
/// events keep the stream moving through states that do not carry an owner.
fn event_from_seed(state: &State, generation: u64, seed: u8) -> Event {
    let choice = seed % 16;
    let kind = if seed & 1 == 0 {
        Kind::Close
    } else {
        Kind::Quit
    };
    let window_exists = seed & 2 == 0;
    let instance_id = format!("bridge-{}", seed % 5);

    let attempt = match state {
        State::AwaitingFrontend { attempt, .. }
        | State::Asking { attempt, .. }
        | State::Recovering { attempt, .. }
        | State::Finalizing { attempt, .. } => Some(attempt),
        State::Recreating { .. } | State::Idle { .. } | State::Exiting { .. } => None,
    };
    let recreation_id = match state {
        State::Recreating { id, .. } => Some(*id),
        State::Idle { .. }
        | State::AwaitingFrontend { .. }
        | State::Asking { .. }
        | State::Recovering { .. }
        | State::Finalizing { .. }
        | State::Exiting { .. } => None,
    };

    match choice {
        0 => Event::Begin {
            kind,
            window_exists,
        },
        1 => match attempt {
            Some(attempt) => Event::Decide {
                attempt_id: attempt.id,
                generation: attempt.generation,
                sequence: attempt.sequence,
                decision: Decision::Allow,
                dirty: false,
                pending: false,
            },
            None => stale_decide(generation, kind, seed),
        },
        2 => match attempt {
            Some(attempt) => Event::Decide {
                attempt_id: attempt.id.saturating_add(1),
                generation: attempt.generation,
                sequence: attempt.sequence,
                decision: Decision::Cancel,
                dirty: false,
                pending: false,
            },
            None => stale_decide(generation, kind, seed),
        },
        3 => match attempt {
            Some(attempt) => Event::Timeout(attempt.clone()),
            None => Event::Timeout(stale_attempt(generation, kind, seed)),
        },
        4 => match attempt {
            Some(attempt) => Event::Timeout(stale_attempt_from(attempt, seed)),
            None => Event::Timeout(stale_attempt(generation, kind, seed)),
        },
        5 => Event::FrontendReady { instance_id },
        6 => match state {
            State::Asking { frontend, .. } => Event::FrontendUnready {
                token: frontend.clone(),
            },
            State::Recreating {
                ready: Some(token), ..
            } => Event::FrontendUnready {
                token: token.clone(),
            },
            _ => Event::FrontendUnready {
                token: Token {
                    instance_id,
                    generation: generation.saturating_add(1),
                },
            },
        },
        7 => match state {
            State::Asking {
                attempt, frontend, ..
            } => Event::EmitFailed {
                attempt: attempt.clone(),
                frontend: frontend.clone(),
            },
            _ => Event::EmitFailed {
                attempt: stale_attempt(generation, kind, seed),
                frontend: Token {
                    instance_id,
                    generation: generation.saturating_add(1),
                },
            },
        },
        8 => match attempt {
            Some(attempt) => Event::Recovered {
                attempt: attempt.clone(),
                allow: seed & 4 == 0,
            },
            None => Event::Recovered {
                attempt: stale_attempt(generation, kind, seed),
                allow: false,
            },
        },
        9 => Event::RecreationStarted,
        10 => match recreation_id {
            Some(id) => Event::RecreationFinished {
                id,
                ok: seed & 4 == 0,
            },
            None => Event::RecreationFinished {
                id: RecreationId(0),
                ok: false,
            },
        },
        11 => match recreation_id {
            Some(id) => Event::RecreationFinished {
                id: RecreationId(id.0.saturating_add(1)),
                ok: true,
            },
            None => Event::RecreationFinished {
                id: RecreationId(0),
                ok: true,
            },
        },
        12 => Event::ExitRequested,
        13 => Event::Exited,
        14 => match attempt {
            Some(attempt) => Event::Finalized {
                attempt: attempt.clone(),
                ok: seed & 4 == 0,
            },
            None => Event::Finalized {
                attempt: stale_attempt(generation, kind, seed),
                ok: false,
            },
        },
        _ => match attempt {
            Some(attempt) => Event::Finalized {
                attempt: stale_attempt_from(attempt, seed),
                ok: true,
            },
            None => Event::Begin {
                kind,
                window_exists,
            },
        },
    }
}

fn stale_attempt(generation: u64, kind: Kind, seed: u8) -> Attempt {
    Attempt {
        id: 0,
        generation: generation.saturating_add(1),
        kind,
        sequence: u64::from(seed),
    }
}

fn stale_attempt_from(attempt: &Attempt, seed: u8) -> Attempt {
    match seed % 4 {
        0 => Attempt {
            id: attempt.id.saturating_sub(1),
            generation: attempt.generation,
            kind: attempt.kind,
            sequence: attempt.sequence,
        },
        1 => Attempt {
            id: attempt.id.saturating_add(1),
            generation: attempt.generation,
            kind: attempt.kind,
            sequence: attempt.sequence,
        },
        2 => Attempt {
            id: attempt.id,
            generation: attempt.generation.saturating_add(1),
            kind: attempt.kind,
            sequence: attempt.sequence,
        },
        _ => Attempt {
            id: attempt.id,
            generation: attempt.generation,
            kind: attempt.kind,
            sequence: attempt.sequence.saturating_add(1),
        },
    }
}

fn stale_decide(generation: u64, kind: Kind, seed: u8) -> Event {
    let attempt = stale_attempt(generation, kind, seed);
    Event::Decide {
        attempt_id: attempt.id,
        generation: attempt.generation,
        sequence: attempt.sequence,
        decision: Decision::Cancel,
        dirty: false,
        pending: false,
    }
}

/// Generate one event while retaining only the public state needed to decode it.
fn arb_event(machine: &Machine) -> BoxedStrategy<Event> {
    let state = machine.state().clone();
    let generation = machine.generation();
    any::<u8>()
        .prop_map(move |seed| event_from_seed(&state, generation, seed))
        .boxed()
}

/// Apply `events` in order and retain the complete public trace.
fn run(machine: &mut Machine, events: Vec<Event>) -> Vec<(Event, State, Vec<Effect>)> {
    events
        .into_iter()
        .map(|event| {
            let effects = machine.step(event.clone());
            (event, machine.state().clone(), effects)
        })
        .collect()
}

fn events_from_seeds(seeds: &[u8]) -> Vec<Event> {
    let mut machine = Machine::new(1);
    seeds
        .iter()
        .map(|seed| {
            let event = event_from_seed(machine.state(), machine.generation(), *seed);
            machine.step(event.clone());
            event
        })
        .collect()
}

fn attempt_in_state(state: &State) -> Option<&Attempt> {
    match state {
        State::AwaitingFrontend { attempt, .. }
        | State::Asking { attempt, .. }
        | State::Recovering { attempt, .. }
        | State::Finalizing { attempt, .. } => Some(attempt),
        State::Idle { .. } | State::Recreating { .. } | State::Exiting { .. } => None,
    }
}

fn same_owner(left: &Attempt, right: &Attempt) -> bool {
    left.id == right.id && left.generation == right.generation && left.sequence == right.sequence
}

fn event_owner_matches(state: &State, event: &Event) -> bool {
    let Some(state_attempt) = attempt_in_state(state) else {
        return false;
    };
    match event {
        Event::Decide {
            attempt_id,
            generation,
            sequence,
            ..
        } => {
            state_attempt.id == *attempt_id
                && state_attempt.generation == *generation
                && state_attempt.sequence == *sequence
        }
        Event::Finalized { attempt, .. }
        | Event::EmitFailed { attempt, .. }
        | Event::Timeout(attempt)
        | Event::Recovered { attempt, .. } => same_owner(state_attempt, attempt),
        Event::Begin { .. }
        | Event::FrontendReady { .. }
        | Event::FrontendUnready { .. }
        | Event::RecreationStarted
        | Event::RecreationFinished { .. }
        | Event::ExitRequested
        | Event::Exited => false,
    }
}

fn native_action_is_allowed(state: &State, event: &Event) -> bool {
    match state {
        State::Idle { hidden_by_close } => {
            matches!(
                event,
                Event::Begin {
                    kind: Kind::Quit,
                    window_exists: false,
                } | Event::Begin {
                    kind: Kind::Quit,
                    window_exists: true,
                } if *hidden_by_close
            ) || matches!(
                event,
                Event::Begin {
                    kind: Kind::Quit,
                    window_exists: false,
                }
            )
        }
        State::Recreating {
            id,
            queued_quit: true,
            ..
        } => matches!(
            event,
            Event::RecreationFinished {
                id: finished_id,
                ok: false,
            } if id == finished_id
        ),
        _ => event_owner_matches(state, event),
    }
}

fn completion_matches_state(state: &State, event: &Event) -> bool {
    match (state, event) {
        (
            State::AwaitingFrontend { attempt, .. } | State::Asking { attempt, .. },
            Event::Timeout(owner),
        )
        | (State::Recovering { attempt, .. }, Event::Recovered { attempt: owner, .. })
        | (State::Finalizing { attempt, .. }, Event::Finalized { attempt: owner, .. }) => {
            same_owner(attempt, owner)
        }
        (
            State::Asking {
                attempt, frontend, ..
            },
            Event::EmitFailed {
                attempt: owner,
                frontend: failed_frontend,
            },
        ) => same_owner(attempt, owner) && frontend == failed_frontend,
        (
            State::Recreating { id, .. },
            Event::RecreationFinished {
                id: finished_id, ..
            },
        ) => id == finished_id,
        _ => false,
    }
}

fn is_completion(event: &Event) -> bool {
    matches!(
        event,
        Event::Finalized { .. }
            | Event::Timeout(_)
            | Event::Recovered { .. }
            | Event::EmitFailed { .. }
            | Event::RecreationFinished { .. }
    )
}

/// Feed only answer events until the machine reaches a terminal resting state.
fn drive_to_rest(machine: &mut Machine, max: usize) -> Option<Vec<(Event, State, Vec<Effect>)>> {
    let mut trace = Vec::new();

    for _ in 0..max {
        let state = machine.state().clone();
        let event = match state {
            State::Idle { .. } => return Some(trace),
            State::AwaitingFrontend { .. } => Event::FrontendReady {
                instance_id: "driver-frontend".into(),
            },
            State::Asking { attempt, .. } => Event::Decide {
                attempt_id: attempt.id,
                generation: attempt.generation,
                sequence: attempt.sequence,
                decision: Decision::Allow,
                dirty: false,
                pending: false,
            },
            State::Recovering { attempt, .. } => Event::Recovered {
                attempt,
                allow: true,
            },
            State::Finalizing { attempt, .. } => Event::Finalized { attempt, ok: true },
            State::Recreating { id, .. } => Event::RecreationFinished { id, ok: true },
            State::Exiting { .. } => Event::ExitRequested,
        };
        let effects = machine.step(event.clone());
        let after = machine.state().clone();
        trace.push((event, after.clone(), effects.clone()));

        if matches!(after, State::Idle { .. }) {
            return Some(trace);
        }
        if matches!(after, State::Exiting { .. })
            && effects
                .iter()
                .any(|effect| matches!(effect, Effect::AllowExit))
        {
            return Some(trace);
        }
    }

    if matches!(machine.state(), State::Idle { .. } | State::Exiting { .. }) {
        Some(trace)
    } else {
        None
    }
}

fn pending_kind(state: &State) -> Option<Kind> {
    match state {
        State::AwaitingFrontend { attempt, .. }
        | State::Asking { attempt, .. }
        | State::Recovering { attempt, .. } => Some(attempt.kind),
        State::Finalizing {
            attempt,
            queued_quit,
            ..
        } => (*queued_quit).then_some(Kind::Quit).or(Some(attempt.kind)),
        State::Recreating { queued_quit, .. } => queued_quit.then_some(Kind::Quit),
        State::Exiting { .. } => Some(Kind::Quit),
        State::Idle { .. } => None,
    }
}

fn count_allow_exit(trace: &[(Event, State, Vec<Effect>)]) -> usize {
    trace
        .iter()
        .flat_map(|(_, _, effects)| effects)
        .filter(|effect| matches!(effect, Effect::AllowExit))
        .count()
}

fn count_finalized_completions(initial: &State, trace: &[(Event, State, Vec<Effect>)]) -> usize {
    let mut previous = initial;
    let mut count = 0;
    for (event, after, _) in trace {
        if matches!(event, Event::Finalized { ok: true, .. })
            && completion_matches_state(previous, event)
        {
            count += 1;
        }
        previous = after;
    }
    count
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10_000,
        .. ProptestConfig::default()
    })]

    #[test]
    fn inv1_no_silent_step(seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);
        let _event_strategy = arb_event(&machine);
        let trace = run(&mut machine, events);

        prop_assert!(trace.iter().all(|(_, _, effects)| !effects.is_empty()));
    }

    #[test]
    fn inv2_no_stale_native_action(seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);

        for event in events {
            let state = machine.state().clone();
            let effects = machine.step(event.clone());
            let has_native_action = effects.iter().any(|effect| {
                matches!(effect, Effect::Finalize(_) | Effect::Exit | Effect::ArmExitBypass(_))
            });

            if has_native_action {
                prop_assert!(
                    native_action_is_allowed(&state, &event),
                    "state={state:?} event={event:?} effects={effects:?}"
                );
            }
        }
    }

    #[test]
    fn inv5_owners_are_monotone(seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);
        let mut attempt_sequences = BTreeMap::new();
        let mut highest_recreation = None;

        for event in events {
            let state_before = machine.state().clone();
            let effects = machine.step(event.clone());

            for attempt in [attempt_in_state(&state_before), attempt_in_state(machine.state())]
                .into_iter()
                .flatten()
            {
                let previous = attempt_sequences.insert(attempt.id, attempt.sequence);
                prop_assert!(previous.is_none_or(|sequence| attempt.sequence >= sequence));
            }
            for effect in &effects {
                let attempt = match effect {
                    Effect::EmitRequest { attempt, .. }
                    | Effect::ScheduleTimeout(attempt)
                    | Effect::ShowRecoveryDialog(attempt)
                    | Effect::Finalize(attempt) => Some(attempt),
                    _ => None,
                };
                if let Some(attempt) = attempt {
                    let previous = attempt_sequences.insert(attempt.id, attempt.sequence);
                    prop_assert!(previous.is_none_or(|sequence| attempt.sequence >= sequence));
                }
                if let Effect::Recreate(RecreationId(id)) = effect {
                    prop_assert!(highest_recreation.is_none_or(|previous| *id >= previous));
                    highest_recreation = Some(*id);
                }
            }
            if let State::Recreating {
                id: RecreationId(id), ..
            } = machine.state()
            {
                prop_assert!(highest_recreation.is_none_or(|previous| *id >= previous));
                highest_recreation = Some(*id);
            }

            if is_completion(&event) && !completion_matches_state(&state_before, &event) {
                prop_assert!(
                    effects.len() == 1 && matches!(effects.first(), Some(Effect::Log(_)))
                );
            }
        }
    }

    #[test]
    fn inv6_bypass_is_one_use_and_generation_bound(
        seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)
    ) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);
        let mut armed_generation = None;
        let mut consumed_since_arm = false;

        for event in events {
            let generation = machine.generation();
            let effects = machine.step(event);
            for effect in effects {
                match effect {
                    Effect::ArmExitBypass(armed) => {
                        armed_generation = Some(armed);
                        consumed_since_arm = false;
                    }
                    Effect::AllowExit => {
                        prop_assert_eq!(armed_generation, Some(generation));
                        prop_assert!(!consumed_since_arm);
                        consumed_since_arm = true;
                        armed_generation = None;
                    }
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn inv3_intents_are_not_lost(seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);
        let prefix = run(&mut machine, events);
        let kind = pending_kind(machine.state());
        let drive_start = machine.state().clone();
        let driven = drive_to_rest(&mut machine, 4);
        prop_assert!(driven.is_some());
        let driven = driven.unwrap_or_default();

        match kind {
            Some(Kind::Quit) => {
                let allows = count_allow_exit(&prefix) + count_allow_exit(&driven);
                prop_assert_eq!(allows, 1);
            }
            Some(Kind::Close) => {
                prop_assert_eq!(count_finalized_completions(&drive_start, &driven), 1);
            }
            None => {}
        }
    }

    #[test]
    fn inv4_states_reach_rest(seeds in prop::collection::vec(any::<u8>(), 1..=MAX_TRACE_LEN)) {
        let events = events_from_seeds(&seeds);
        let mut machine = Machine::new(1);
        let _ = run(&mut machine, events);

        prop_assert!(drive_to_rest(&mut machine, 4).is_some());
    }
}
