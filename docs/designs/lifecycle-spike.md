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
