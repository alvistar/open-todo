#![cfg_attr(mobile, tauri::mobile_entry_point)]

mod lifecycle;

use lifecycle::{
    BeginResult, DecisionResult, FinalizeResult, FrontendToken, LifecycleAttempt,
    LifecycleCoordinator, LifecycleDecisionPayload, LifecycleKind,
};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewWindow,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
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
    coordinator: Mutex<LifecycleCoordinator>,
}

#[derive(Clone, Debug, Serialize)]
struct LifecycleDiagnostic<'a> {
    message: &'a str,
}

#[tauri::command]
fn lifecycle_ready(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<FrontendToken, String> {
    let mut coordinator = state
        .coordinator
        .lock()
        .map_err(|_| "desktop lifecycle state is unavailable".to_string())?;
    // A destroyed main window cannot deliver a late initial ready call. Any
    // ready handshake that arrives here therefore belongs to this generation;
    // the returned token makes its later cleanup generation-specific.
    Ok(coordinator.frontend_ready(instance_id))
}

#[tauri::command]
fn lifecycle_unready(state: State<'_, AppState>, token: FrontendToken) -> Result<(), String> {
    let mut coordinator = state
        .coordinator
        .lock()
        .map_err(|_| "desktop lifecycle state is unavailable".to_string())?;
    coordinator.frontend_unready(&token);
    Ok(())
}

#[tauri::command]
fn lifecycle_decision(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: LifecycleDecisionPayload,
) -> Result<(), String> {
    let result = {
        let mut coordinator = state
            .coordinator
            .lock()
            .map_err(|_| "desktop lifecycle state is unavailable".to_string())?;
        coordinator.decide(&payload)
    };

    match result {
        DecisionResult::Authorized(attempt) => finalize_attempt(&app, &state, attempt),
        DecisionResult::Cancelled | DecisionResult::Stale => Ok(()),
        DecisionResult::Recheck(attempt) => {
            if let Err(error) = emit_lifecycle_request(&app, &attempt) {
                mark_frontend_unready(&state);
                emit_lifecycle_error(
                    &app,
                    "The editor did not respond to the desktop close request.",
                );
                log::warn!("could not send lifecycle recheck: {error}");
                show_native_recovery(&app, attempt);
            }
            Ok(())
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be registered first. Its callback
        // only activates or recreates the one main window; it never opens a
        // second window or imports a session from the new process.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            activate_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            coordinator: Mutex::new(LifecycleCoordinator::new(1)),
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle_ready,
            lifecycle_unready,
            lifecycle_decision,
        ])
        .setup(|app| {
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
                if window.app_handle().try_state::<AppState>().is_none() {
                    log::error!("desktop lifecycle state missing during close");
                    return;
                }
                api.prevent_close();
                request_lifecycle(window.app_handle(), LifecycleKind::Close);
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
                let bypass = match state.coordinator.lock() {
                    Ok(mut coordinator) => {
                        let generation = coordinator.generation();
                        coordinator.take_exit_bypass(generation)
                    }
                    Err(_) => {
                        log::error!("desktop lifecycle state lock failed during quit");
                        false
                    }
                };
                if bypass {
                    return;
                }
                api.prevent_exit();
                request_lifecycle(app, LifecycleKind::Quit);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => activate_main_window(app),
            tauri::RunEvent::Ready => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    ensure_usable_geometry(&window);
                }
            }
            tauri::RunEvent::Exit => {
                if let Err(error) = app.save_window_state(WINDOW_STATE_FLAGS) {
                    log::warn!("could not persist window geometry: {error}");
                }
            }
            _ => {}
        });
}

fn request_lifecycle<R: Runtime>(app: &AppHandle<R>, kind: LifecycleKind) {
    let Some(state) = app.try_state::<AppState>() else {
        log::error!("desktop lifecycle state missing while requesting action");
        return;
    };
    let has_visible_window = app
        .get_webview_window(MAIN_WINDOW)
        .map(|window| window.is_visible().unwrap_or(true))
        .unwrap_or(false);
    let result = match state.coordinator.lock() {
        Ok(mut coordinator) => coordinator.begin(kind, has_visible_window),
        Err(_) => {
            log::error!("desktop lifecycle state lock failed while requesting action");
            return;
        }
    };

    match result {
        BeginResult::AllowDirect => {
            if let Ok(mut coordinator) = state.coordinator.lock() {
                let generation = coordinator.generation();
                coordinator.arm_exit_bypass(generation);
            }
            app.exit(0);
        }
        BeginResult::Ask(attempt) => {
            if let Err(error) = emit_lifecycle_request(app, &attempt) {
                mark_frontend_unready(&state);
                emit_lifecycle_error(
                    app,
                    "The editor did not respond to the desktop close request.",
                );
                log::warn!("could not send lifecycle request: {error}");
                show_native_recovery(app, attempt);
            } else {
                schedule_recovery_timeout(app, attempt);
            }
        }
        BeginResult::Recover(attempt) => show_native_recovery(app, attempt),
        BeginResult::Ignore | BeginResult::Queued(_) => {}
    }
}

fn emit_lifecycle_request<R: Runtime>(
    app: &AppHandle<R>,
    attempt: &LifecycleAttempt,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Err("main window is unavailable".to_string());
    };
    window
        .emit("lifecycle:request", attempt)
        .map_err(|error| format!("could not reach the frontend: {error}"))
}

fn mark_frontend_unready(state: &AppState) {
    if let Ok(mut coordinator) = state.coordinator.lock() {
        coordinator.frontend_lost();
    }
}

fn schedule_recovery_timeout<R: Runtime>(app: &AppHandle<R>, attempt: LifecycleAttempt) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let Some(state) = app_handle.try_state::<AppState>() else {
            return;
        };
        let expired = state
            .coordinator
            .lock()
            .map(|mut coordinator| coordinator.timeout_expired(&attempt))
            .unwrap_or(false);
        if !expired {
            return;
        }
        emit_lifecycle_error(
            &app_handle,
            "The editor did not respond to the desktop close request.",
        );
        show_native_recovery(&app_handle, attempt);
    });
}

fn emit_lifecycle_error<R: Runtime>(app: &AppHandle<R>, message: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.emit("lifecycle:error", LifecycleDiagnostic { message });
    }
}

fn show_native_recovery<R: Runtime>(app: &AppHandle<R>, attempt: LifecycleAttempt) {
    let Some(state) = app.try_state::<AppState>() else {
        log::error!("desktop lifecycle state missing before recovery dialog");
        return;
    };
    let should_show = state
        .coordinator
        .lock()
        .map(|mut coordinator| coordinator.start_recovery(&attempt))
        .unwrap_or(false);
    if !should_show {
        return;
    }

    let app_handle = app.clone();
    let action = if attempt.kind == LifecycleKind::Quit {
        "exit anyway"
    } else {
        "close anyway"
    };
    let allow_label = if attempt.kind == LifecycleKind::Quit {
        "Exit anyway"
    } else {
        "Close anyway"
    };
    let message = format!(
        "The editor did not respond. Cancel to keep open-todo running, or {action} with a possible loss of unsaved work."
    );
    app.dialog()
        .message(message)
        .title("open-todo needs a decision")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            allow_label.to_string(),
            "Cancel".to_string(),
        ))
        .show(move |allow_exit| {
            let Some(state) = app_handle.try_state::<AppState>() else {
                log::error!("desktop lifecycle state missing during recovery");
                return;
            };
            let authorized = match state.coordinator.lock() {
                Ok(mut coordinator) => coordinator.recover(&attempt, allow_exit),
                Err(_) => {
                    log::error!("desktop lifecycle state lock failed during recovery");
                    false
                }
            };
            if authorized {
                finalize_attempt(&app_handle, &state, attempt).unwrap_or_else(|error| {
                    log::error!("desktop recovery action failed: {error}");
                });
            }
        });
}

fn finalize_attempt<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    attempt: LifecycleAttempt,
) -> Result<(), String> {
    let authorization = match state.coordinator.lock() {
        Ok(mut coordinator) => coordinator.authorize_finalize(&attempt),
        Err(_) => return Err("desktop lifecycle state lock failed while finalizing".to_string()),
    };
    if authorization == FinalizeResult::Stale {
        log::warn!(
            "discarding stale lifecycle attempt {} at generation {}",
            attempt.attempt_id,
            attempt.generation
        );
        return Ok(());
    }

    let result = match attempt.kind {
        LifecycleKind::Close => match app.get_webview_window(MAIN_WINDOW) {
            None => Ok(()),
            Some(window) => {
                #[cfg(target_os = "macos")]
                {
                    let hidden = window
                        .hide()
                        .map_err(|error| format!("could not hide the main window: {error}"));
                    if hidden.is_ok() {
                        if let Err(error) = app.save_window_state(WINDOW_STATE_FLAGS) {
                            log::warn!("could not persist window geometry: {error}");
                        }
                    }
                    hidden.map(|_| ())
                }
                #[cfg(not(target_os = "macos"))]
                {
                    if let Ok(mut coordinator) = state.coordinator.lock() {
                        coordinator.arm_exit_bypass(attempt.generation);
                    }
                    window
                        .destroy()
                        .map_err(|error| format!("could not destroy the main window: {error}"))
                }
            }
        },
        LifecycleKind::Quit => {
            if let Ok(mut coordinator) = state.coordinator.lock() {
                coordinator.arm_exit_bypass(attempt.generation);
            }
            app.exit(0);
            Ok(())
        }
    };
    let pending_kind = state
        .coordinator
        .lock()
        .map(|mut coordinator| coordinator.finish_finalize(&attempt))
        .unwrap_or(None);
    if let Some(kind) = pending_kind {
        request_lifecycle(app, kind);
    }
    result
}

fn activate_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if window.is_minimized().unwrap_or(false) {
            if let Err(error) = window.unminimize() {
                emit_lifecycle_error(
                    app,
                    "The existing window could not be restored from its minimized state.",
                );
                log::warn!("could not unminimize the main window: {error}");
            }
        }
        if let Err(error) = window.show() {
            emit_lifecycle_error(app, "The existing window could not be shown.");
            log::warn!("could not show the main window: {error}");
        }
        if let Err(error) = window.set_focus() {
            emit_lifecycle_error(app, "The existing window could not be focused.");
            log::warn!("could not focus the main window: {error}");
        }
        return;
    }

    let Some(state) = app.try_state::<AppState>() else {
        emit_lifecycle_error(app, "The desktop lifecycle state is unavailable.");
        log::error!("desktop lifecycle state missing while recreating the main window");
        return;
    };
    let should_recreate = match state.coordinator.lock() {
        Ok(mut coordinator) => coordinator.begin_recreation(),
        Err(_) => {
            emit_lifecycle_error(app, "The desktop lifecycle state is unavailable.");
            log::error!("desktop lifecycle state lock failed while recreating the main window");
            false
        }
    };
    if !should_recreate {
        return;
    }

    let app_handle = app.clone();
    std::thread::spawn(move || recreate_main_window(&app_handle));
}

fn recreate_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
    else {
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut coordinator) = state.coordinator.lock() {
                coordinator.finish_recreation(false);
            }
        }
        emit_recreation_error(app);
        log::error!("main window configuration is missing");
        return;
    };

    let result =
        tauri::WebviewWindowBuilder::from_config(app, &config).and_then(|builder| builder.build());
    let succeeded = result.is_ok();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut coordinator) = state.coordinator.lock() {
            coordinator.finish_recreation(succeeded);
        }
    }

    match result {
        Ok(window) => ensure_usable_geometry(&window),
        Err(error) => {
            emit_recreation_error(app);
            log::error!("could not recreate the main window: {error}");
        }
    }
}

fn emit_recreation_error<R: Runtime>(app: &AppHandle<R>) {
    const MESSAGE: &str = "The main window could not be recreated. Try launching open-todo again.";
    emit_lifecycle_error(app, MESSAGE);
    app.dialog()
        .message(MESSAGE)
        .title("open-todo")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn rectangles_have_usable_intersection(window: Rect, monitor: Rect) -> bool {
    let right = monitor.x.saturating_add(monitor.width as i32);
    let bottom = monitor.y.saturating_add(monitor.height as i32);
    let window_right = window.x.saturating_add(window.width as i32);
    let window_bottom = window.y.saturating_add(window.height as i32);
    window.x < right
        && window_right > monitor.x
        && window.y < bottom
        && window_bottom > monitor.y
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
        assert!(rectangles_have_usable_intersection(enough_for_controls, monitor));
    }
}
