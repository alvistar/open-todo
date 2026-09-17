//! Property tests for `machine::Machine::step`.

use super::machine::*;
use proptest::prelude::*;

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
            Some(attempt) => Event::Timeout(stale_attempt_from(attempt)),
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
                attempt: stale_attempt_from(attempt),
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

fn stale_attempt_from(attempt: &Attempt) -> Attempt {
    Attempt {
        id: attempt.id.saturating_add(1),
        generation: attempt.generation,
        kind: attempt.kind,
        sequence: attempt.sequence,
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
}
