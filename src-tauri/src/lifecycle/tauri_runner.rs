//! `EffectRunner` over `tauri::AppHandle` (slice 4). Coordinator-declared; filled by the worker.

use super::machine::{Attempt, Decision, Effect, Event, Kind, RecreationId, Token};
use super::runtime::{EffectRunner, Envelope};
use serde::{Deserialize, Serialize};
use std::sync::{mpsc::Sender, Arc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(not(test))]
use tauri_plugin_window_state::AppHandleExt as WindowStateAppHandleExt;

const MAIN_WINDOW: &str = "main";

#[derive(Clone, Debug, Serialize)]
struct LifecycleDiagnostic<'a> {
    message: &'a str,
}

type Recreate<R> = dyn Fn(&AppHandle<R>) -> Result<(), String> + Send + Sync + 'static;

pub struct TauriRunner<R: Runtime> {
    app: AppHandle<R>,
    ask_timeout: Duration,
    recreate: Arc<Recreate<R>>,
}

impl<R: Runtime> TauriRunner<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            ask_timeout: Duration::from_secs(5),
            recreate: Arc::new(recreate_main_window),
        }
    }

    #[cfg(test)]
    fn with_recreate<F>(app: AppHandle<R>, recreate: F) -> Self
    where
        F: Fn(&AppHandle<R>) -> Result<(), String> + Send + Sync + 'static,
    {
        Self {
            app,
            ask_timeout: Duration::from_secs(5),
            recreate: Arc::new(recreate),
        }
    }
}

impl<R: Runtime> EffectRunner for TauriRunner<R> {
    fn run(&mut self, effect: Effect, tx: &Sender<Envelope>) {
        match effect {
            Effect::EmitRequest { attempt, frontend } => {
                let Some(window) = self.app.get_webview_window(MAIN_WINDOW) else {
                    send_event(tx, Event::EmitFailed { attempt, frontend });
                    self.emit_error("The editor did not respond to the desktop close request.");
                    return;
                };
                if window
                    .emit("lifecycle:request", WireAttempt::from(&attempt))
                    .is_err()
                {
                    send_event(tx, Event::EmitFailed { attempt, frontend });
                    self.emit_error("The editor did not respond to the desktop close request.");
                }
            }
            Effect::ScheduleTimeout(attempt) => {
                let timeout = self.ask_timeout;
                let thread_tx = tx.clone();
                let thread_attempt = attempt.clone();
                let spawn = thread::Builder::new()
                    .name("lifecycle-timeout".into())
                    .spawn(move || {
                        thread::sleep(timeout);
                        send_event(&thread_tx, Event::Timeout(thread_attempt));
                    });
                if spawn.is_err() {
                    send_event(tx, Event::Timeout(attempt));
                }
            }
            Effect::ShowRecoveryDialog(attempt) => {
                self.show_recovery_dialog(attempt, tx);
            }
            Effect::ShowWindow => self.show_window(),
            Effect::Finalize(attempt) => self.finalize(attempt, tx),
            Effect::ArmExitBypass(generation) => {
                log::debug!("lifecycle exit bypass armed for generation {generation}");
            }
            Effect::Exit => self.app.exit(0),
            Effect::AllowExit => log::debug!("lifecycle exit allowed"),
            Effect::PreventExit => log::debug!("lifecycle exit prevented"),
            Effect::Recreate(id) => {
                let app = self.app.clone();
                let recreate = self.recreate.clone();
                let thread_tx = tx.clone();
                let spawn = thread::Builder::new()
                    .name("lifecycle-recreate".into())
                    .spawn(move || {
                        let mut guard = RecreationGuard {
                            tx: thread_tx,
                            id,
                            completed: false,
                        };
                        if let Err(error) = recreate(&app) {
                            log::error!("could not recreate the main window: {error}");
                            return;
                        }
                        send_event(&guard.tx, Event::RecreationFinished { id, ok: true });
                        guard.completed = true;
                    });
                if spawn.is_err() {
                    send_event(tx, Event::RecreationFinished { id, ok: false });
                }
            }
            Effect::ReplyToken(token) => log::debug!(
                "lifecycle ready reply dropped for instance {} generation {}",
                token.instance_id,
                token.generation
            ),
            Effect::EmitError(message) => self.emit_error(&message),
            Effect::Log(reason) => log::debug!("lifecycle: {reason}"),
        }
    }
}

impl<R: Runtime> TauriRunner<R> {
    fn emit_error(&self, message: &str) {
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            let _ = window.emit("lifecycle:error", LifecycleDiagnostic { message });
        }
    }

    fn show_window(&self) {
        let Some(window) = self.app.get_webview_window(MAIN_WINDOW) else {
            self.emit_error("The main window could not be shown.");
            return;
        };
        if !window.is_visible().unwrap_or(true) {
            if let Err(error) = window.show() {
                self.emit_error("The main window could not be shown.");
                log::warn!("could not show the main window: {error}");
            }
            if let Err(error) = window.set_focus() {
                self.emit_error("The main window could not be focused.");
                log::warn!("could not focus the main window: {error}");
            }
        }
    }

    fn show_recovery_dialog(&self, attempt: Attempt, tx: &Sender<Envelope>) {
        if self.app.get_webview_window(MAIN_WINDOW).is_none() {
            send_event(
                tx,
                Event::Recovered {
                    attempt,
                    allow: false,
                },
            );
            self.emit_error("The main window is unavailable for lifecycle recovery.");
            return;
        }
        let action = if attempt.kind == Kind::Quit {
            "exit anyway"
        } else {
            "close anyway"
        };
        let allow_label = if attempt.kind == Kind::Quit {
            "Exit anyway"
        } else {
            "Close anyway"
        };
        let message = format!(
            "The editor did not respond. Cancel to keep open-todo running, or {action} with a possible loss of unsaved work."
        );
        let tx = tx.clone();
        self.app
            .dialog()
            .message(message)
            .title("open-todo needs a decision")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                allow_label.to_string(),
                "Cancel".to_string(),
            ))
            .show(move |allow| {
                send_event(&tx, Event::Recovered { attempt, allow });
            });
    }

    fn finalize(&self, attempt: Attempt, tx: &Sender<Envelope>) {
        let ok = match attempt.kind {
            Kind::Close => match self.app.get_webview_window(MAIN_WINDOW) {
                Some(window) => {
                    #[cfg(target_os = "macos")]
                    {
                        match window.hide() {
                            Ok(()) => {
                                #[cfg(not(test))]
                                if let Err(error) =
                                    self.app.save_window_state(crate::WINDOW_STATE_FLAGS)
                                {
                                    log::warn!("could not persist window geometry: {error}");
                                }
                                true
                            }
                            Err(error) => {
                                log::warn!("could not hide the main window: {error}");
                                false
                            }
                        }
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        window.destroy().is_ok()
                    }
                }
                None => false,
            },
            Kind::Quit => {
                send_event(
                    tx,
                    Event::Finalized {
                        attempt: attempt.clone(),
                        ok: true,
                    },
                );
                self.app.exit(0);
                return;
            }
        };
        send_event(tx, Event::Finalized { attempt, ok });
        if !ok {
            self.emit_error("The main window could not be finalized.");
        }
    }
}

fn send_event(tx: &Sender<Envelope>, event: Event) {
    let _ = tx.send(Envelope { event, reply: None });
}

struct RecreationGuard {
    tx: Sender<Envelope>,
    id: RecreationId,
    completed: bool,
}

impl Drop for RecreationGuard {
    fn drop(&mut self) {
        if !self.completed {
            send_event(
                &self.tx,
                Event::RecreationFinished {
                    id: self.id,
                    ok: false,
                },
            );
        }
    }
}

fn recreate_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
        .ok_or_else(|| "main window configuration is missing".to_string())?;
    let window = WebviewWindowBuilder::from_config(app, &config)
        .and_then(|builder| builder.build())
        .map_err(|error| format!("could not recreate the main window: {error}"))?;
    crate::ensure_usable_geometry(&window);
    Ok(())
}

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
    use crate::lifecycle::machine::{Attempt, Kind};
    use std::sync::mpsc;
    use std::time::Duration;

    fn attempt() -> Attempt {
        Attempt {
            id: 7,
            generation: 3,
            kind: Kind::Close,
            sequence: 1,
        }
    }

    fn quit_attempt() -> Attempt {
        Attempt {
            kind: Kind::Quit,
            ..attempt()
        }
    }

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

    #[test]
    fn show_window_makes_hidden_main_window_visible() {
        let app = tauri::test::mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        window.hide().unwrap();

        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, _rx) = mpsc::channel();
        runner.run(Effect::ShowWindow, &tx);

        assert!(window.is_visible().unwrap());
    }

    #[test]
    fn emit_request_without_main_reports_emit_failure() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, rx) = mpsc::channel();
        let attempt = attempt();
        let frontend = Token {
            instance_id: "bridge".into(),
            generation: 3,
        };

        runner.run(
            Effect::EmitRequest {
                attempt: attempt.clone(),
                frontend: frontend.clone(),
            },
            &tx,
        );

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::EmitFailed { attempt, frontend }
        );
    }

    #[test]
    fn recovery_without_main_cancels_the_native_action() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, rx) = mpsc::channel();
        let attempt = attempt();

        runner.run(Effect::ShowRecoveryDialog(attempt.clone()), &tx);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::Recovered {
                attempt,
                allow: false,
            }
        );
    }

    #[test]
    // MockRuntime hard-codes `is_visible()` to true and `hide()` to a no-op;
    // visibility is covered by the packaged smoke and the Q3 spike.
    fn finalize_close_reports_success() {
        let app = tauri::test::mock_app();
        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, rx) = mpsc::channel();
        let attempt = attempt();

        runner.run(Effect::Finalize(attempt.clone()), &tx);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::Finalized { attempt, ok: true }
        );
    }

    #[test]
    fn finalize_without_main_reports_failure() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, rx) = mpsc::channel();
        let attempt = attempt();

        runner.run(Effect::Finalize(attempt.clone()), &tx);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::Finalized { attempt, ok: false }
        );
    }

    #[test]
    fn finalize_quit_reports_before_requesting_exit() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::new(app.handle().clone());
        let (tx, rx) = mpsc::channel();
        let attempt = quit_attempt();

        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            runner.run(Effect::Finalize(attempt.clone()), &tx);
        }));

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::Finalized { attempt, ok: true }
        );
    }

    #[test]
    fn schedule_timeout_sends_completion_after_configured_delay() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::new(app.handle().clone());
        runner.ask_timeout = Duration::from_millis(10);
        let (tx, rx) = mpsc::channel();
        let attempt = attempt();

        runner.run(Effect::ScheduleTimeout(attempt.clone()), &tx);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::Timeout(attempt)
        );
    }

    #[test]
    fn recreation_panic_reports_failure_through_drop_guard() {
        let app = tauri::test::mock_app();
        let mut runner = TauriRunner::with_recreate(app.handle().clone(), |_| {
            panic!("recreation failed in test");
        });
        let (tx, rx) = mpsc::channel();

        runner.run(Effect::Recreate(RecreationId(4)), &tx);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().event,
            Event::RecreationFinished {
                id: RecreationId(4),
                ok: false,
            }
        );
    }
}
