# Packaged lifecycle spike observations

Platform: macOS 26.6.2, arm64. The packaged app was launched from a terminal so
stderr could be observed; `osascript` had Accessibility access and returned no
permission errors. The temporary source hooks used below were removed after each
observation.

## Q1 — ⌘Q while the native recovery dialog is modal

Procedure: built with `PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH"
pnpm desktop:build`, then launched
`OPEN_TODO_LIFECYCLE_SPIKE=q1 RUST_LOG=info src-tauri/target/release/bundle/macos/open-todo.app/Contents/MacOS/open-todo`.
The temporary `lifecycle_decision` command returned without answering, making the
bridge unresponsive. With the packaged app frontmost, I pressed `⌘W`, waited for the
recovery dialog, confirmed its native modal UI was visible, pressed `⌘Q`, and read the
same terminal's stderr.

Raw stderr excerpt:

```text
SPIKE Q1 lifecycle_decision suppressed
```

No `SPIKE Q1 ExitRequested received` line appeared after `⌘Q`. The observed answer is
no: `RunEvent::ExitRequested` did not reach the handler while
`tauri-plugin-dialog`'s recovery dialog was modal. This changes
`Recovering × Begin(Quit)`: delete the `upgrade_to_quit` cell because the native key
event cannot reach it in this modal state.

## Q2 — window rebuild from a worker thread

Procedure: added temporary timestamped stderr logs to `recreate_main_window` (after
`WebviewWindowBuilder::build`) and `lifecycle_ready`. Because macOS `⌘W` hides the
window rather than destroying its handle, I used the coordinator-approved temporary
SPIKE hook to destroy the sole main window after launch. The hook also prevented the
destroy-induced `ExitRequested` so the process remained alive. I then clicked the
running app's Dock icon and read the packaged app's terminal stderr.

Raw stderr excerpt (Unix epoch milliseconds):

```text
SPIKE Q2 lifecycle_ready received at 1789667602342 ms
SPIKE Q2 temporary destroy started at 1789667605137 ms
SPIKE Q2 temporary destroy succeeded
SPIKE Q2 ExitRequested prevented after destroy
SPIKE Q2 window built at 1789667619723 ms
SPIKE Q2 lifecycle_ready received at 1789667619868 ms
```

The worker-thread rebuild succeeded. In this run the new bridge handshake arrived
145 ms after the window-built log, so `lifecycle_ready` did not arrive before the
build completed. The observation confirms the `Recreating × FrontendReady` D12 cell
and keeps the reserved-generation readiness handling. It also records that the
production macOS close path is hide-only; the rebuild path required the temporary
destroy precondition.

## Q3 — main-thread requirement

Procedure: added a temporary `#[tauri::command]` that spawned a worker thread and
called `hide`, `show`, and `destroy` sequentially on the main window. The command was
triggered after startup in a packaged app launched from a terminal, and the worker
logged each return value. A temporary guard prevented the destroy-induced final
`ExitRequested` from ending the process before the last log was flushed.

Raw stderr excerpt:

```text
SPIKE Q3 ThreadId(21) hide succeeded
SPIKE Q3 ThreadId(21) show succeeded
SPIKE Q3 ThreadId(21) destroy succeeded
SPIKE Q3 ExitRequested prevented after destroy
```

All three operations succeeded from the spawned worker thread; no error text was
returned. This confirms the Q3 runner choice in the current macOS packaged runtime:
`Finalize` and `ShowWindow` do not require `run_on_main_thread` for these operations.

## Q4 — hidden window's bridge

Procedure: launched the packaged app with a temporary watcher, brought it frontmost,
and pressed `⌘W`. The production close flow hid the window while retaining its
WebView handle. Once hidden, the watcher invoked a temporary command that called the
old coordinator with `window_exists=true` (the normal old helper would direct-exit
when visibility is false) and emitted `lifecycle:request`. The temporary
`lifecycle_decision` log included the attempt and sequence; stderr was read from the
launching terminal.

Raw stderr excerpt (Unix epoch milliseconds):

```text
SPIKE Q4 lifecycle_decision received for attempt 1 sequence 0 at 1789668023694 ms
SPIKE Q4 hidden window detected at 1789668023730 ms
SPIKE Q4 lifecycle:request emitted for attempt 2 at 1789668023730 ms
SPIKE Q4 lifecycle_decision received for attempt 2 sequence 0 at 1789668023731 ms
```

The hidden WebView bridge answered the request in 1 ms, well within the 5 s ask
timeout. This confirms hidden-bridge liveness for
`Idle{hidden_by_close:false} × Begin(Quit)` and supports D11's `ShowWindow`-then-ask
cell. The temporary path did not itself exercise `ShowWindow`; Q3's worker-thread
`show succeeded` observation is the evidence available for that runner effect.
