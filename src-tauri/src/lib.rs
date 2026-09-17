#![cfg_attr(mobile, tauri::mobile_entry_point)]

mod lifecycle;

use lifecycle::machine::{Event, Kind, Machine};
use lifecycle::runtime::{spawn_loop, ExitVerdict, LifecycleHandle};
use lifecycle::tauri_runner::{TauriRunner, WireDecision, WireToken};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt as WindowStateAppHandleExt, StateFlags};

const MAIN_WINDOW: &str = "main";
const DEFAULT_WIDTH: u32 = 1180;
const DEFAULT_HEIGHT: u32 = 760;
const MIN_WIDTH: u32 = 360;
const MIN_HEIGHT: u32 = 420;
const WINDOW_STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::DECORATIONS);

pub struct AppState {
    lifecycle: LifecycleHandle,
}

#[tauri::command]
fn lifecycle_ready(state: State<'_, AppState>, instance_id: String) -> Result<WireToken, String> {
    state
        .lifecycle
        .ready(instance_id)
        .map(|token| WireToken::from(&token))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn lifecycle_unready(state: State<'_, AppState>, token: WireToken) {
    state.lifecycle.send(Event::FrontendUnready {
        token: token.into(),
    });
}

#[tauri::command]
fn lifecycle_decision(state: State<'_, AppState>, payload: WireDecision) {
    state.lifecycle.send(payload.into());
}

pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered first. Its callback
        // only activates or recreates the one main window; it never opens a
        // second window or imports a session from the new process.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let Some(state) = app.try_state::<AppState>() else {
                log::error!("desktop lifecycle state missing during activation");
                return;
            };
            on_activate(app, &state.lifecycle);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            lifecycle_ready,
            lifecycle_unready,
            lifecycle_decision,
        ])
        .setup(|app| {
            app.manage(AppState {
                lifecycle: spawn_loop(Machine::new(0), TauriRunner::new(app.handle().clone())),
            });
            if cfg!(debug_assertions) {
                log::debug!("open-todo desktop shell started");
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                ensure_usable_geometry(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let Some(state) = window.app_handle().try_state::<AppState>() else {
                    log::error!("desktop lifecycle state missing during close");
                    return;
                };
                on_close_requested(api, &state.lifecycle);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the open-todo desktop shell")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let Some(state) = app.try_state::<AppState>() else {
                    log::error!("desktop lifecycle state missing during quit");
                    return;
                };
                on_exit_requested(&api, &state.lifecycle);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let Some(state) = app.try_state::<AppState>() else {
                    log::error!("desktop lifecycle state missing during reopen");
                    return;
                };
                on_activate(app, &state.lifecycle);
            }
            tauri::RunEvent::Ready => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    ensure_usable_geometry(&window);
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.lifecycle.send(Event::Exited);
                }
                if let Err(error) = app.save_window_state(WINDOW_STATE_FLAGS) {
                    log::warn!("could not persist window geometry: {error}");
                }
            }
            _ => {}
        });
}

fn on_close_requested(api: &tauri::CloseRequestApi, lifecycle: &LifecycleHandle) {
    api.prevent_close();
    lifecycle.send(Event::Begin {
        kind: Kind::Close,
        window_exists: true,
    });
}

fn on_exit_requested(api: &tauri::ExitRequestApi, lifecycle: &LifecycleHandle) {
    if on_exit_verdict(lifecycle) == ExitVerdict::Prevent {
        api.prevent_exit();
    }
}

fn on_exit_verdict(lifecycle: &LifecycleHandle) -> ExitVerdict {
    lifecycle.exit_requested()
}

fn on_activate<R: Runtime>(app: &AppHandle<R>, lifecycle: &LifecycleHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if window.is_minimized().unwrap_or(false) {
            if let Err(error) = window.unminimize() {
                log::warn!("could not unminimize the main window: {error}");
            }
        }
        if let Err(error) = window.show() {
            log::warn!("could not show the main window: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::warn!("could not focus the main window: {error}");
        }
        return;
    }
    lifecycle.send(Event::RecreationStarted);
}

fn ensure_usable_geometry<R: Runtime>(window: &WebviewWindow<R>) {
    let size = window.inner_size().unwrap_or(PhysicalSize {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
    });
    let position = window
        .outer_position()
        .unwrap_or(PhysicalPosition { x: 0, y: 0 });
    let monitors = window.available_monitors().unwrap_or_default();
    let visible = monitors
        .iter()
        .any(|monitor| monitor_intersects(monitor, position, size));
    if visible && size.width >= MIN_WIDTH && size.height >= MIN_HEIGHT {
        return;
    }

    log::warn!("stored window geometry was not usable; using safe defaults");
    if let Err(error) = window.set_size(PhysicalSize {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
    }) {
        log::warn!("could not restore default window size: {error}");
    }
    if let Err(error) = window.center() {
        log::warn!("could not center the main window: {error}");
    }
}

fn monitor_intersects(
    monitor: &tauri::Monitor,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> bool {
    rectangles_have_usable_intersection(
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        },
    )
}

#[cfg(test)]
mod lifecycle_mapping_tests {
    use super::*;
    use lifecycle::machine::{Attempt, Decision, Effect, Event, Kind, Machine, RecreationId};
    use lifecycle::runtime::{spawn_loop, EffectRunner, Envelope, ExitVerdict};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    struct RecordingRunner {
        seen: Arc<Mutex<Vec<Effect>>>,
        notifications: mpsc::Sender<()>,
        responses: Arc<Mutex<Vec<(Effect, Event)>>>,
    }

    impl EffectRunner for RecordingRunner {
        fn run(&mut self, effect: Effect, tx: &mpsc::Sender<Envelope>) {
            self.seen.lock().unwrap().push(effect.clone());
            let mut responses = self.responses.lock().unwrap();
            let response = responses
                .iter()
                .position(|(trigger, _)| trigger == &effect)
                .map(|index| responses.remove(index).1);
            drop(responses);
            if let Some(event) = response {
                let _ = tx.send(Envelope { event, reply: None });
            }
            let _ = self.notifications.send(());
        }
    }

    fn recording_runner(
        responses: Vec<(Effect, Event)>,
    ) -> (RecordingRunner, Arc<Mutex<Vec<Effect>>>, mpsc::Receiver<()>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (notifications, observed) = mpsc::channel();
        (
            RecordingRunner {
                seen: seen.clone(),
                notifications,
                responses: Arc::new(Mutex::new(responses)),
            },
            seen,
            observed,
        )
    }

    #[test]
    fn exit_requested_without_bypass_prevents_and_begins_quit() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (notifications, observed) = mpsc::channel();
        let handle = spawn_loop(
            Machine::new(0),
            RecordingRunner {
                seen: seen.clone(),
                notifications,
                responses: Arc::new(Mutex::new(Vec::new())),
            },
        );

        assert_eq!(on_exit_verdict(&handle), ExitVerdict::Prevent);
        observed
            .recv_timeout(Duration::from_secs(1))
            .expect("prevent effect was not observed");
        observed
            .recv_timeout(Duration::from_secs(1))
            .expect("begin quit effect was not observed");
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                Effect::PreventExit,
                Effect::ScheduleTimeout(lifecycle::machine::Attempt {
                    id: 1,
                    generation: 0,
                    kind: Kind::Quit,
                    sequence: 0,
                }),
            ]
        );
    }

    #[test]
    fn exit_requested_with_armed_bypass_allows_exit() {
        let attempt = Attempt {
            id: 1,
            generation: 0,
            kind: Kind::Close,
            sequence: 0,
        };
        let (runner, _seen, observed) = recording_runner(vec![(
            Effect::Finalize(attempt.clone()),
            Event::Finalized { attempt, ok: true },
        )]);
        let handle = spawn_loop(Machine::new(0), runner);
        assert_eq!(
            handle.ready("bridge".into()).unwrap(),
            lifecycle::machine::Token {
                instance_id: "bridge".into(),
                generation: 0,
            }
        );
        handle.send(Event::Begin {
            kind: Kind::Close,
            window_exists: true,
        });
        for _ in 0..3 {
            observed
                .recv_timeout(Duration::from_secs(1))
                .expect("close effects were not observed");
        }
        handle.send(Event::Decide {
            attempt_id: 1,
            generation: 0,
            sequence: 0,
            decision: Decision::Allow,
            dirty: false,
            pending: false,
        });
        observed
            .recv_timeout(Duration::from_secs(1))
            .expect("finalize effect was not observed");
        handle.send(Event::Begin {
            kind: Kind::Quit,
            window_exists: true,
        });
        for _ in 0..2 {
            observed
                .recv_timeout(Duration::from_secs(1))
                .expect("exit effects were not observed");
        }

        assert_eq!(on_exit_verdict(&handle), ExitVerdict::Allow);
    }

    #[test]
    fn activation_without_main_starts_recreation() {
        let app = tauri::test::mock_app();
        let (runner, seen, observed) = recording_runner(Vec::new());
        let handle = spawn_loop(Machine::new(0), runner);

        on_activate(&app.handle().clone(), &handle);
        observed
            .recv_timeout(Duration::from_secs(1))
            .expect("recreation effect was not observed");

        assert_eq!(
            *seen.lock().unwrap(),
            vec![Effect::Recreate(RecreationId(1))]
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn rectangles_have_usable_intersection(window: Rect, monitor: Rect) -> bool {
    let monitor_right = monitor.x as i64 + monitor.width as i64;
    let monitor_bottom = monitor.y as i64 + monitor.height as i64;
    let window_right = window.x as i64 + window.width as i64;
    let window_bottom = window.y as i64 + window.height as i64;
    let overlap_width =
        (window_right.min(monitor_right) - (window.x as i64).max(monitor.x as i64)).max(0);
    let overlap_height =
        (window_bottom.min(monitor_bottom) - (window.y as i64).max(monitor.y as i64)).max(0);
    overlap_width >= MIN_WIDTH as i64 && overlap_height >= MIN_HEIGHT as i64
}

#[cfg(test)]
mod geometry_tests {
    use super::*;

    #[test]
    fn orig_5_requires_a_minimum_usable_monitor_overlap() {
        let monitor = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let one_pixel = Rect {
            x: 1919,
            y: 1079,
            width: 400,
            height: 400,
        };
        let enough_for_controls = Rect {
            x: 1560,
            y: 660,
            width: 360,
            height: 420,
        };

        // A visible window must retain at least the 360x420 minimum-size area
        // on one monitor; a 1x1 sliver cannot expose usable controls.
        assert!(!rectangles_have_usable_intersection(one_pixel, monitor));
        assert!(rectangles_have_usable_intersection(
            enough_for_controls,
            monitor
        ));
    }
}
