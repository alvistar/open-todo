//! `EffectRunner` over `tauri::AppHandle` (slice 4). Coordinator-declared; filled by the worker.
#![allow(dead_code)]

use super::machine::{Attempt, Decision, Effect, Event, Kind, RecreationId, Token};
use super::runtime::{EffectRunner, Envelope};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WireKind {
    Close,
    Quit,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WireChoice {
    Allow,
    Discard,
    Cancel,
    ExitAnyway,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireAttempt {
    pub attempt_id: u64,
    pub generation: u64,
    pub kind: WireKind,
    pub request_sequence: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireToken {
    pub instance_id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireDecision {
    pub attempt_id: u64,
    pub generation: u64,
    pub request_sequence: u64,
    pub decision: WireChoice,
    pub dirty: bool,
    pub pending: bool,
}

impl From<&Attempt> for WireAttempt {
    fn from(attempt: &Attempt) -> Self {
        Self {
            attempt_id: attempt.id,
            generation: attempt.generation,
            kind: match attempt.kind {
                Kind::Close => WireKind::Close,
                Kind::Quit => WireKind::Quit,
            },
            request_sequence: attempt.sequence,
        }
    }
}

impl From<WireAttempt> for Attempt {
    fn from(attempt: WireAttempt) -> Self {
        Self {
            id: attempt.attempt_id,
            generation: attempt.generation,
            kind: match attempt.kind {
                WireKind::Close => Kind::Close,
                WireKind::Quit => Kind::Quit,
            },
            sequence: attempt.request_sequence,
        }
    }
}

impl From<&Token> for WireToken {
    fn from(token: &Token) -> Self {
        Self {
            instance_id: token.instance_id.clone(),
            generation: token.generation,
        }
    }
}

impl From<WireToken> for Token {
    fn from(token: WireToken) -> Self {
        Self {
            instance_id: token.instance_id,
            generation: token.generation,
        }
    }
}

impl From<WireDecision> for Event {
    fn from(decision: WireDecision) -> Self {
        Self::Decide {
            attempt_id: decision.attempt_id,
            generation: decision.generation,
            sequence: decision.request_sequence,
            decision: match decision.decision {
                WireChoice::Allow => Decision::Allow,
                WireChoice::Discard => Decision::Discard,
                WireChoice::Cancel => Decision::Cancel,
                WireChoice::ExitAnyway => Decision::ExitAnyway,
            },
            dirty: decision.dirty,
            pending: decision.pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_attempt_round_trips_the_bridge_payload() {
        let attempt = Attempt {
            id: 7,
            generation: 3,
            kind: Kind::Quit,
            sequence: 2,
        };

        let wire = WireAttempt::from(&attempt);

        assert_eq!(
            serde_json::to_value(&wire).unwrap(),
            serde_json::json!({
                "attemptId": 7,
                "generation": 3,
                "kind": "quit",
                "requestSequence": 2,
            })
        );
    }

    #[test]
    fn wire_attempt_converts_back_to_machine_attempt() {
        let attempt: Attempt = WireAttempt {
            attempt_id: 7,
            generation: 3,
            kind: WireKind::Quit,
            request_sequence: 2,
        }
        .into();

        assert_eq!(
            attempt,
            Attempt {
                id: 7,
                generation: 3,
                kind: Kind::Quit,
                sequence: 2,
            }
        );
    }

    #[test]
    fn wire_decision_converts_bridge_payload_to_machine_event() {
        let payload: WireDecision = serde_json::from_value(serde_json::json!({
            "attemptId": 7,
            "generation": 3,
            "requestSequence": 2,
            "decision": "exit-anyway",
            "dirty": true,
            "pending": false,
        }))
        .unwrap();

        assert_eq!(
            Event::from(payload),
            Event::Decide {
                attempt_id: 7,
                generation: 3,
                sequence: 2,
                decision: Decision::ExitAnyway,
                dirty: true,
                pending: false,
            }
        );
    }
}
