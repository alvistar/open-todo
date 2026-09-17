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

