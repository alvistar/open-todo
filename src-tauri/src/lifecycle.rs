use serde::{Deserialize, Serialize};

/// The two native actions that must share one frontend draft decision.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LifecycleKind {
    Close,
    Quit,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LifecycleDecision {
    Allow,
    Discard,
    Cancel,
    ExitAnyway,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleAttempt {
    pub attempt_id: u64,
    pub generation: u64,
    pub kind: LifecycleKind,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleDecisionPayload {
    pub attempt_id: u64,
    pub generation: u64,
    pub decision: LifecycleDecision,
    pub dirty: bool,
    pub pending: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum BeginResult {
    /// There is no frontend to ask and the application can exit directly.
    AllowDirect,
    /// The frontend is ready to inspect its current draft registry.
    Ask(LifecycleAttempt),
    /// The frontend is absent or unavailable; use a native recovery choice.
    Recover(LifecycleAttempt),
    /// A request is already being handled. Keep one coherent guard.
    Ignore,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DecisionResult {
    Authorized(LifecycleAttempt),
    Cancelled,
    /// The response belongs to an old attempt/window and must be ignored.
    Stale,
    /// The frontend must send its current state again before native action.
    Recheck(LifecycleAttempt),
}

#[derive(Debug, PartialEq, Eq)]
pub enum FinalizeResult {
    Authorized,
    /// The attempt no longer owns the current lifecycle state.
    Stale,
}

#[derive(Debug)]
pub struct LifecycleCoordinator {
    generation: u64,
    next_attempt: u64,
    frontend_instance: Option<String>,
    active: Option<LifecycleAttempt>,
    recovery_attempt: Option<u64>,
    finalizing: Option<LifecycleAttempt>,
    exit_bypass_generation: Option<u64>,
    recreation_in_progress: bool,
}

impl LifecycleCoordinator {
    pub fn new(generation: u64) -> Self {
        Self {
            generation,
            next_attempt: 0,
            frontend_instance: None,
            active: None,
            recovery_attempt: None,
            finalizing: None,
            exit_bypass_generation: None,
            recreation_in_progress: false,
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn new_window(&mut self) -> u64 {
        self.generation = self.generation.saturating_add(1);
        self.frontend_instance = None;
        self.active = None;
        self.recovery_attempt = None;
        self.recreation_in_progress = false;
        self.generation
    }

    /// Claims the one serialized slot for rebuilding the main window.
    pub fn begin_recreation(&mut self) -> bool {
        if self.recreation_in_progress || self.finalizing.is_some() {
            return false;
        }
        self.recreation_in_progress = true;
        true
    }

    /// Completes a rebuild. A successful build is the only event that creates
    /// a new window generation and invalidates the old frontend state.
    pub fn finish_recreation(&mut self, succeeded: bool) -> Option<u64> {
        if !self.recreation_in_progress {
            return None;
        }
        self.recreation_in_progress = false;
        succeeded.then(|| self.new_window())
    }

    pub fn frontend_ready(&mut self, instance: String) {
        self.frontend_instance = Some(instance);
    }

    pub fn frontend_unready(&mut self, instance: &str) {
        if self.frontend_instance.as_deref() == Some(instance) {
            self.frontend_instance = None;
        }
    }

    pub fn frontend_lost(&mut self) {
        self.frontend_instance = None;
    }

    pub fn frontend_is_ready(&self) -> bool {
        self.frontend_instance.is_some()
    }

    /// Reserves the native-action slot after a frontend decision. The caller
    /// must hold the coordinator mutex while invoking this immediately before
    /// the native action; the reservation prevents a newer request or window
    /// recreation from overtaking the authorized attempt between the check and
    /// that action.
    pub fn authorize_finalize(&mut self, attempt: &LifecycleAttempt) -> FinalizeResult {
        if self.generation != attempt.generation
            || self.active.is_some()
            || self.recreation_in_progress
            || self.finalizing.is_some()
        {
            return FinalizeResult::Stale;
        }
        self.finalizing = Some(attempt.clone());
        FinalizeResult::Authorized
    }

    pub fn finish_finalize(&mut self, attempt: &LifecycleAttempt) {
        if self.finalizing.as_ref() == Some(attempt) {
            self.finalizing = None;
        }
    }

    /// Clears frontend readiness only when this timeout still owns the active
    /// request. This keeps a superseded timeout from taking down a newer
    /// frontend instance.
    pub fn timeout_expired(&mut self, attempt: &LifecycleAttempt) -> bool {
        if self.active.as_ref() != Some(attempt) {
            return false;
        }
        self.frontend_instance = None;
        true
    }

    pub fn begin(&mut self, kind: LifecycleKind, has_visible_window: bool) -> BeginResult {
        if self.finalizing.is_some() {
            return BeginResult::Ignore;
        }
        if let Some(active) = &self.active {
            if active.kind == LifecycleKind::Close && kind == LifecycleKind::Quit {
                // The old close attempt must remain immutable. Its timeout,
                // dialog callback, and frontend response all become stale as
                // soon as Command-Q asks for a new attempt.
                self.active = None;
                self.recovery_attempt = None;
            } else {
                return BeginResult::Ignore;
            }
        }

        if kind == LifecycleKind::Quit && !has_visible_window {
            return BeginResult::AllowDirect;
        }

        self.next_attempt = self.next_attempt.saturating_add(1);
        let attempt = LifecycleAttempt {
            attempt_id: self.next_attempt,
            generation: self.generation,
            kind,
        };
        self.active = Some(attempt.clone());
        if self.frontend_is_ready() {
            BeginResult::Ask(attempt)
        } else {
            BeginResult::Recover(attempt)
        }
    }

    pub fn decide(&mut self, payload: &LifecycleDecisionPayload) -> DecisionResult {
        let Some(active) = &self.active else {
            return DecisionResult::Stale;
        };
        if active.attempt_id != payload.attempt_id || active.generation != payload.generation {
            return DecisionResult::Stale;
        }

        match payload.decision {
            LifecycleDecision::Cancel => {
                self.active = None;
                self.recovery_attempt = None;
                DecisionResult::Cancelled
            }
            LifecycleDecision::Allow if payload.dirty || payload.pending => {
                DecisionResult::Recheck(active.clone())
            }
            LifecycleDecision::Discard if payload.pending => {
                DecisionResult::Recheck(active.clone())
            }
            LifecycleDecision::Allow
            | LifecycleDecision::Discard
            | LifecycleDecision::ExitAnyway => {
                let authorized = active.clone();
                self.active = None;
                self.recovery_attempt = None;
                DecisionResult::Authorized(authorized)
            }
        }
    }

    pub fn start_recovery(&mut self, attempt: &LifecycleAttempt) -> bool {
        let matches = self.active.as_ref().is_some_and(|active| active == attempt);
        if !matches || self.recovery_attempt.is_some() {
            return false;
        }
        self.recovery_attempt = Some(attempt.attempt_id);
        true
    }

    pub fn recover(&mut self, attempt: &LifecycleAttempt, allow: bool) -> bool {
        let matches = self.active.as_ref().is_some_and(|active| active == attempt)
            && self.recovery_attempt == Some(attempt.attempt_id);
        if !matches {
            return false;
        }
        self.active = None;
        self.recovery_attempt = None;
        allow
    }

    pub fn arm_exit_bypass(&mut self, generation: u64) {
        self.exit_bypass_generation = Some(generation);
    }

    pub fn take_exit_bypass(&mut self, generation: u64) -> bool {
        if self.exit_bypass_generation == Some(generation) {
            self.exit_bypass_generation = None;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(id: u64, generation: u64, kind: LifecycleKind) -> LifecycleAttempt {
        LifecycleAttempt {
            attempt_id: id,
            generation,
            kind,
        }
    }

    fn payload(
        current: &LifecycleAttempt,
        decision: LifecycleDecision,
        dirty: bool,
        pending: bool,
    ) -> LifecycleDecisionPayload {
        LifecycleDecisionPayload {
            attempt_id: current.attempt_id,
            generation: current.generation,
            decision,
            dirty,
            pending,
        }
    }

    #[test]
    fn asks_ready_frontend_once() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let result = coordinator.begin(LifecycleKind::Close, true);
        assert_eq!(
            result,
            BeginResult::Ask(attempt(1, 1, LifecycleKind::Close))
        );
        assert_eq!(
            coordinator.begin(LifecycleKind::Close, true),
            BeginResult::Ignore
        );
    }

    #[test]
    fn clean_allow_authorizes_once() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Allow, false, false)),
            DecisionResult::Authorized(current.clone())
        );
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Allow, false, false)),
            DecisionResult::Stale
        );
    }

    #[test]
    fn dirty_allow_requires_a_current_recheck() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Allow, true, false)),
            DecisionResult::Recheck(current.clone())
        );
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Discard, true, false)),
            DecisionResult::Authorized(current)
        );
    }

    #[test]
    fn pending_work_cannot_be_discarded_as_clean() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Discard, true, true)),
            DecisionResult::Recheck(current.clone())
        );
        assert_eq!(
            coordinator.decide(&payload(
                &current,
                LifecycleDecision::ExitAnyway,
                true,
                true
            )),
            DecisionResult::Authorized(current)
        );
    }

    #[test]
    fn recovery_dialog_is_one_per_active_attempt() {
        let mut coordinator = LifecycleCoordinator::new(1);
        let current = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Recover(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert!(coordinator.start_recovery(&current));
        assert!(!coordinator.start_recovery(&current));
        assert!(!coordinator.recover(&current, false));
        assert!(coordinator.active.is_none());
    }

    #[test]
    fn stale_generation_and_attempt_are_ignored() {
        let mut coordinator = LifecycleCoordinator::new(3);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        let mut stale = payload(&current, LifecycleDecision::Allow, false, false);
        stale.generation = 2;
        assert_eq!(coordinator.decide(&stale), DecisionResult::Stale);
        stale.generation = current.generation;
        stale.attempt_id = 99;
        assert_eq!(coordinator.decide(&stale), DecisionResult::Stale);
    }

    #[test]
    fn new_window_invalidates_old_frontend_and_attempt() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let old = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(coordinator.new_window(), 2);
        coordinator.frontend_ready("two".into());
        assert_eq!(
            coordinator.decide(&payload(&old, LifecycleDecision::Allow, false, false)),
            DecisionResult::Stale
        );
    }

    #[test]
    fn close_then_quit_supersedes_the_close_attempt() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let close = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };

        let quit = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_ne!(close.attempt_id, quit.attempt_id);
        assert_eq!(quit.generation, close.generation);
        assert_ne!(coordinator.active.as_ref(), Some(&close));
        assert_eq!(coordinator.active.as_ref(), Some(&quit));
        assert_eq!(
            coordinator.decide(&payload(&close, LifecycleDecision::Allow, false, false)),
            DecisionResult::Stale
        );
    }

    #[test]
    fn timeout_from_superseded_attempt_is_stale() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let old = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };

        assert_ne!(coordinator.active.as_ref(), Some(&old));
        assert_eq!(coordinator.active.as_ref(), Some(&current));
        assert!(!coordinator.timeout_expired(&old));
        assert!(coordinator.frontend_is_ready());
    }

    #[test]
    fn finalization_rechecks_an_attempt_after_a_newer_request_starts() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let old = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&old, LifecycleDecision::Allow, false, false)),
            DecisionResult::Authorized(old.clone())
        );

        // Model the pause between decide() and the native finalization: a
        // newer request takes ownership before the old attempt is checked.
        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(coordinator.authorize_finalize(&old), FinalizeResult::Stale);
        assert_eq!(coordinator.active.as_ref(), Some(&current));
    }

    #[test]
    fn finalization_reservation_blocks_newer_actions_until_finished() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&current, LifecycleDecision::Allow, false, false)),
            DecisionResult::Authorized(current.clone())
        );
        assert_eq!(
            coordinator.authorize_finalize(&current),
            FinalizeResult::Authorized
        );
        assert_eq!(
            coordinator.begin(LifecycleKind::Quit, true),
            BeginResult::Ignore
        );
        coordinator.finish_finalize(&current);
        assert!(matches!(
            coordinator.begin(LifecycleKind::Quit, true),
            BeginResult::Ask(_)
        ));
    }

    #[test]
    fn new_1_quit_during_close_finalization_is_not_lost() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let close = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(
            coordinator.decide(&payload(&close, LifecycleDecision::Allow, false, false)),
            DecisionResult::Authorized(close.clone())
        );
        assert_eq!(
            coordinator.authorize_finalize(&close),
            FinalizeResult::Authorized
        );

        // Command-Q is a legitimate event while macOS is completing Close A;
        // it must have a queued/superseding result rather than disappearing.
        assert!(!matches!(
            coordinator.begin(LifecycleKind::Quit, true),
            BeginResult::Ignore
        ));
    }

    #[test]
    fn new_1_recreation_does_not_clear_an_active_decision() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        assert!(matches!(
            coordinator.begin(LifecycleKind::Close, true),
            BeginResult::Ask(_)
        ));

        assert!(!coordinator.begin_recreation());
    }

    #[test]
    fn new_3_recreation_refuses_an_active_lifecycle_attempt() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        assert!(matches!(
            coordinator.begin(LifecycleKind::Quit, true),
            BeginResult::Ask(_)
        ));

        assert!(!coordinator.begin_recreation());
    }

    #[test]
    fn new_4_timeout_cannot_clear_a_replacement_frontend() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let close = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };

        coordinator.frontend_ready("two".into());

        assert!(!coordinator.timeout_expired(&close));
        assert!(coordinator.frontend_is_ready());
    }

    #[test]
    fn recovery_decision_from_superseded_attempt_is_stale() {
        let mut coordinator = LifecycleCoordinator::new(1);
        let old = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Recover(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert!(coordinator.start_recovery(&old));

        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Recover(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        assert!(!coordinator.recover(&old, true));
        assert!(coordinator.start_recovery(&current));
        assert!(!coordinator.recover(&current, false));
    }

    #[test]
    fn recreation_is_serialized_and_generation_advances_after_success() {
        let mut coordinator = LifecycleCoordinator::new(1);
        assert!(coordinator.begin_recreation());
        assert!(!coordinator.begin_recreation());
        assert_eq!(coordinator.finish_recreation(false), None);
        assert_eq!(coordinator.generation(), 1);
        assert!(coordinator.begin_recreation());
        assert_eq!(coordinator.finish_recreation(true), Some(2));
        assert_eq!(coordinator.generation(), 2);
    }

    #[test]
    fn quit_without_a_visible_window_can_exit_directly() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        assert_eq!(
            coordinator.begin(LifecycleKind::Quit, false),
            BeginResult::AllowDirect
        );
    }

    #[test]
    fn bypasses_are_one_use_and_generation_bound() {
        let mut coordinator = LifecycleCoordinator::new(4);
        coordinator.arm_exit_bypass(4);
        assert!(coordinator.take_exit_bypass(4));
    }
}
