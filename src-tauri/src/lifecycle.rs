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
    pub request_sequence: u64,
}

/// A readiness token is issued by the native window generation that accepted
/// the bridge. Old cleanup from another generation cannot clear a replacement.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendToken {
    pub instance_id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleDecisionPayload {
    pub attempt_id: u64,
    pub generation: u64,
    pub request_sequence: u64,
    pub decision: LifecycleDecision,
    pub dirty: bool,
    pub pending: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct FrontendReadyOutcome {
    pub token: FrontendToken,
    pub reemit: Option<LifecycleAttempt>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum TimeoutOutcome {
    Expired,
    Stale,
    Reemit(LifecycleAttempt),
}

#[derive(Debug, PartialEq, Eq)]
pub struct RecreationOutcome {
    pub generation: Option<u64>,
    pub pending_kind: Option<LifecycleKind>,
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
    /// A quit arrived while a close is finishing; replay it after the native
    /// close action releases its reservation.
    Queued(LifecycleKind),
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

#[derive(Debug)]
pub struct LifecycleCoordinator {
    generation: u64,
    next_attempt: u64,
    frontend_instance: Option<FrontendToken>,
    active: Option<LifecycleAttempt>,
    recovery_attempt: Option<u64>,
    finalizing: Option<LifecycleAttempt>,
    pending_kind: Option<LifecycleKind>,
    active_frontend: Option<FrontendToken>,
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
            pending_kind: None,
            active_frontend: None,
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
        self.active_frontend = None;
        self.pending_kind = None;
        self.recreation_in_progress = false;
        self.generation
    }

    /// Claims the one serialized slot for rebuilding the main window.
    pub fn begin_recreation(&mut self) -> bool {
        if self.recreation_in_progress || self.finalizing.is_some() || self.active.is_some() {
            return false;
        }
        self.recreation_in_progress = true;
        true
    }

    /// Completes a rebuild. A successful build is the only event that creates
    /// a new window generation and invalidates the old frontend state.
    pub fn finish_recreation(&mut self, succeeded: bool) -> RecreationOutcome {
        if !self.recreation_in_progress {
            return RecreationOutcome {
                generation: None,
                pending_kind: None,
            };
        }
        self.recreation_in_progress = false;
        let pending_kind = self.pending_kind.take();
        let generation = succeeded.then(|| self.new_window());
        RecreationOutcome {
            generation,
            pending_kind,
        }
    }

    pub fn frontend_ready(&mut self, instance_id: String) -> FrontendReadyOutcome {
        let token = FrontendToken {
            instance_id,
            generation: self.generation,
        };
        self.frontend_instance = Some(token.clone());
        let reemit = self.active.as_ref().and_then(|active| {
            if self.active_frontend.as_ref() == Some(&token) {
                return None;
            }
            let mut reemit = active.clone();
            reemit.request_sequence = reemit.request_sequence.saturating_add(1);
            Some(reemit)
        });
        FrontendReadyOutcome { token, reemit }
    }

    /// Moves an active request onto the frontend that just became ready. The
    /// caller must do this before emitting the returned request so an older
    /// timeout or response cannot overtake the replacement bridge.
    pub fn prepare_frontend_reemit(&mut self, attempt: &LifecycleAttempt) -> bool {
        let Some(active) = self.active.as_ref() else {
            return false;
        };
        if active.attempt_id != attempt.attempt_id
            || active.generation != attempt.generation
            || active.request_sequence >= attempt.request_sequence
        {
            return false;
        }
        let Some(frontend) = self.frontend_instance.clone() else {
            return false;
        };
        self.active = Some(attempt.clone());
        self.active_frontend = Some(frontend);
        true
    }

    pub fn frontend_unready(&mut self, token: &FrontendToken) {
        if self.frontend_instance.as_ref() == Some(token) {
            self.frontend_instance = None;
        }
    }

    pub fn frontend_lost(&mut self) {
        self.frontend_instance = None;
    }

    pub fn frontend_is_ready(&self) -> bool {
        self.frontend_instance.is_some()
    }

    pub fn finish_finalize(&mut self, attempt: &LifecycleAttempt) -> Option<LifecycleKind> {
        if self.finalizing.as_ref() == Some(attempt) {
            self.finalizing = None;
            return self.pending_kind.take();
        }
        None
    }

    /// Clears frontend readiness only when this timeout still owns the active
    /// request. This keeps a superseded timeout from taking down a newer
    /// frontend instance.
    pub fn timeout_expired(&mut self, attempt: &LifecycleAttempt) -> TimeoutOutcome {
        if self.active.as_ref() != Some(attempt) {
            return TimeoutOutcome::Stale;
        }
        let frontend_changed = match (&self.active_frontend, &self.frontend_instance) {
            (Some(owner), Some(current)) => owner != current,
            (None, Some(_)) => true,
            _ => false,
        };
        if frontend_changed {
            let Some(current_frontend) = self.frontend_instance.clone() else {
                return TimeoutOutcome::Expired;
            };
            let mut reemit = attempt.clone();
            reemit.request_sequence = reemit.request_sequence.saturating_add(1);
            self.active = Some(reemit.clone());
            self.active_frontend = Some(current_frontend);
            return TimeoutOutcome::Reemit(reemit);
        }
        self.frontend_instance = None;
        TimeoutOutcome::Expired
    }

    pub fn begin(&mut self, kind: LifecycleKind, has_visible_window: bool) -> BeginResult {
        if self.finalizing.is_some() {
            if self
                .finalizing
                .as_ref()
                .is_some_and(|attempt| attempt.kind == LifecycleKind::Close)
                && kind == LifecycleKind::Quit
            {
                self.pending_kind = Some(LifecycleKind::Quit);
                return BeginResult::Queued(LifecycleKind::Quit);
            }
            return BeginResult::Ignore;
        }
        if self.recreation_in_progress {
            if kind == LifecycleKind::Quit {
                self.pending_kind = Some(LifecycleKind::Quit);
                return BeginResult::Queued(LifecycleKind::Quit);
            }
            return BeginResult::Ignore;
        }
        if let Some(active) = &self.active {
            if active.kind == LifecycleKind::Close && kind == LifecycleKind::Quit {
                // The old close attempt must remain immutable. Its timeout,
                // dialog callback, and frontend response all become stale as
                // soon as Command-Q asks for a new attempt.
                self.active = None;
                self.recovery_attempt = None;
                self.active_frontend = None;
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
            request_sequence: 0,
        };
        self.active = Some(attempt.clone());
        self.active_frontend = self.frontend_instance.clone();
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
        if active.attempt_id != payload.attempt_id
            || active.generation != payload.generation
            || active.request_sequence != payload.request_sequence
        {
            return DecisionResult::Stale;
        }

        match payload.decision {
            LifecycleDecision::Cancel => {
                self.active = None;
                self.recovery_attempt = None;
                self.active_frontend = None;
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
                self.active_frontend = None;
                self.finalizing = Some(authorized.clone());
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

    pub fn recover(&mut self, attempt: &LifecycleAttempt, allow: bool) -> Option<LifecycleAttempt> {
        let matches = self.active.as_ref().is_some_and(|active| active == attempt)
            && self.recovery_attempt == Some(attempt.attempt_id);
        if !matches {
            return None;
        }
        self.active = None;
        self.recovery_attempt = None;
        self.active_frontend = None;
        if allow {
            self.finalizing = Some(attempt.clone());
            Some(attempt.clone())
        } else {
            None
        }
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
            request_sequence: 0,
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
            request_sequence: current.request_sequence,
            decision,
            dirty,
            pending,
        }
    }

    #[test]
    fn b1_timeout_reemits_an_active_attempt_after_frontend_replacement() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let close = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };
        coordinator.frontend_ready("two".into());

        let expected = attempt(1, 1, LifecycleKind::Close);
        assert_eq!(
            coordinator.timeout_expired(&close),
            TimeoutOutcome::Reemit(LifecycleAttempt {
                request_sequence: 1,
                ..expected
            })
        );
    }

    #[test]
    fn b1_frontend_ready_reports_an_active_attempt_for_reemit() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let close = match coordinator.begin(LifecycleKind::Close, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };

        let ready = coordinator.frontend_ready("two".into());

        assert_eq!(
            ready.reemit,
            Some(LifecycleAttempt {
                request_sequence: 1,
                ..close
            })
        );
    }

    #[test]
    fn s1_decide_reserves_finalization_before_recreation_can_begin() {
        let mut coordinator = LifecycleCoordinator::new(1);
        coordinator.frontend_ready("one".into());
        let current = match coordinator.begin(LifecycleKind::Quit, true) {
            BeginResult::Ask(attempt) => attempt,
            other => panic!("unexpected {other:?}"),
        };

        let authorized =
            match coordinator.decide(&payload(&current, LifecycleDecision::Allow, false, false)) {
                DecisionResult::Authorized(attempt) => attempt,
                other => panic!("unexpected {other:?}"),
            };

        assert!(!coordinator.begin_recreation());
        assert_eq!(coordinator.finish_finalize(&authorized), None);
        assert!(coordinator.begin_recreation());
    }

    #[test]
    fn s2_quit_during_recreation_is_queued_and_replayed_after_success() {
        let mut coordinator = LifecycleCoordinator::new(1);
        assert!(coordinator.begin_recreation());

        assert_eq!(
            coordinator.begin(LifecycleKind::Quit, false),
            BeginResult::Queued(LifecycleKind::Quit)
        );
        let result = coordinator.finish_recreation(true);

        assert_eq!(result.pending_kind, Some(LifecycleKind::Quit));
    }

    #[test]
    fn s2_quit_during_recreation_is_replayed_after_failure_too() {
        let mut coordinator = LifecycleCoordinator::new(1);
        assert!(coordinator.begin_recreation());
        assert_eq!(
            coordinator.begin(LifecycleKind::Quit, false),
            BeginResult::Queued(LifecycleKind::Quit)
        );

        let result = coordinator.finish_recreation(false);

        assert_eq!(result.pending_kind, Some(LifecycleKind::Quit));
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
        let recheck =
            match coordinator.decide(&payload(&current, LifecycleDecision::Allow, true, false)) {
                DecisionResult::Recheck(attempt) => attempt,
                other => panic!("unexpected {other:?}"),
            };
        assert_eq!(
            coordinator.decide(&payload(&recheck, LifecycleDecision::Discard, true, false,)),
            DecisionResult::Authorized(recheck)
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
        let recheck =
            match coordinator.decide(&payload(&current, LifecycleDecision::Discard, true, true)) {
                DecisionResult::Recheck(attempt) => attempt,
                other => panic!("unexpected {other:?}"),
            };
        assert_eq!(
            coordinator.decide(&payload(
                &recheck,
                LifecycleDecision::ExitAnyway,
                true,
                true
            )),
            DecisionResult::Authorized(recheck)
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
        assert!(coordinator.recover(&current, false).is_none());
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
        assert_eq!(coordinator.timeout_expired(&old), TimeoutOutcome::Stale);
        assert!(coordinator.frontend_is_ready());
    }

    #[test]
    fn finalization_reservation_is_taken_before_a_newer_request_can_start() {
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

        // The reservation is now taken by decide() while the coordinator
        // mutex is held, so neither recreation nor a newer action can race it.
        assert!(!coordinator.begin_recreation());
        assert_eq!(
            coordinator.begin(LifecycleKind::Quit, true),
            BeginResult::Queued(LifecycleKind::Quit)
        );
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

        assert!(matches!(
            coordinator.timeout_expired(&close),
            TimeoutOutcome::Reemit(LifecycleAttempt {
                request_sequence: 1,
                ..
            })
        ));
        assert!(coordinator.frontend_is_ready());
    }

    #[test]
    fn readiness_cleanup_is_bound_to_the_native_generation_token() {
        let mut coordinator = LifecycleCoordinator::new(1);
        let old = coordinator.frontend_ready("old".into()).token;
        let new = coordinator.frontend_ready("new".into()).token;

        coordinator.frontend_unready(&old);
        assert!(coordinator.frontend_is_ready());
        coordinator.frontend_unready(&new);
        assert!(!coordinator.frontend_is_ready());
    }

    #[test]
    fn readiness_tokens_record_the_window_generation() {
        let mut coordinator = LifecycleCoordinator::new(1);
        let old = coordinator.frontend_ready("old".into()).token;
        assert_eq!(old.generation, 1);
        assert_eq!(coordinator.new_window(), 2);
        let current = coordinator.frontend_ready("current".into()).token;
        assert_eq!(current.generation, 2);
        coordinator.frontend_unready(&old);
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
        assert!(coordinator.recover(&old, true).is_none());
        assert!(coordinator.start_recovery(&current));
        assert!(coordinator.recover(&current, false).is_none());
    }

    #[test]
    fn recreation_is_serialized_and_generation_advances_after_success() {
        let mut coordinator = LifecycleCoordinator::new(1);
        assert!(coordinator.begin_recreation());
        assert!(!coordinator.begin_recreation());
        let failed = coordinator.finish_recreation(false);
        assert_eq!(failed.generation, None);
        assert_eq!(failed.pending_kind, None);
        assert_eq!(coordinator.generation(), 1);
        assert!(coordinator.begin_recreation());
        let succeeded = coordinator.finish_recreation(true);
        assert_eq!(succeeded.generation, Some(2));
        assert_eq!(succeeded.pending_kind, None);
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
