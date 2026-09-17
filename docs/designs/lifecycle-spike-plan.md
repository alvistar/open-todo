# Slice 0: packaged lifecycle spike (plan for the worker)

Parent design: `docs/designs/lifecycle-state-machine.md` §6 slice 0 and §8. This slice
produces **observations, not product code**. Its deliverable is
`docs/designs/lifecycle-spike.md`, one section per question below, each with the exact
procedure run, the observed result, and the table cell it confirms or changes. Throwaway
code lives on this branch only and is deleted or left unmerged; nothing here ships.

## Questions to answer (each = one observation with evidence)

- **Q1 — ⌘Q while the native recovery dialog is modal.** Does `RunEvent::ExitRequested`
  fire while `tauri-plugin-dialog`'s message dialog (`lib.rs` `show_native_recovery`) is
  open? Procedure: make the bridge unresponsive (temporarily stub `lifecycle_decision`
  to never answer, or kill the WebView's listener), press ⌘W to open the dialog, press
  ⌘Q, log whether `ExitRequested` arrived (add a `log::info!` in the handler; read the
  packaged app's stderr by launching the `.app` binary from a terminal). Cell affected:
  `Recovering × Begin(Quit)` (`upgrade_to_quit`): keep if ⌘Q arrives, delete if not.
- **Q2 — window rebuild from a worker thread.** Does `recreate_main_window` (spawned on
  `std::thread`) build the window reliably on macOS, and can the new WebView's
  `lifecycle_ready` arrive before the thread dispatches completion? Procedure: add two
  timestamped logs (window built; `lifecycle_ready` received), close the window, click
  the Dock icon, read the order. Cell affected: `Recreating × FrontendReady` (D12).
- **Q3 — main-thread requirement.** Do `hide`, `show`, `destroy` succeed when called from
  a non-main thread (a `std::thread::spawn` after a command)? Procedure: call each from
  a spawned thread behind a temporary command; record success or the error text. Cell
  affected: runner implementation of `Finalize`/`ShowWindow` (`run_on_main_thread` or
  not).
- **Q4 — hidden window's bridge.** After ⌘W hides the window on macOS, does the bridge
  still receive `lifecycle:request` and answer `lifecycle_decision` within 5 s?
  Procedure: hide, then trigger a request (temporary command or ⌘Q with the current
  code and a dirty draft after an `exit-anyway` stub), log the round trip. Cell
  affected: `Idle{hidden_by_close:false} × Begin(Quit)` after ⌘H (D11, `ShowWindow`).
- **Q5 — `app.exit` re-entrancy.** With `ExitRequested` prevented once, does a second
  `app.exit(0)` from another thread exit, and in what order do `ExitRequested` and
  `Exit` fire? Procedure: temporary command that calls `app.exit(0)` twice from two
  threads with logs. Cell affected: `Exiting × ExitRequested` (D10/8).

## Files and symbols in scope

- `src-tauri/src/lib.rs`: temporary logs and temporary `#[tauri::command]`s, clearly
  marked `// SPIKE` and removed before the final commit of this slice unless the note
  says a log is worth keeping.
- `docs/designs/lifecycle-spike.md`: the deliverable.
- A throwaway script under `scripts/spike/` (not committed if it contains machine
  paths) to build, launch the packaged binary from a terminal and send keystrokes with
  `osascript` (`tell application "System Events" to keystroke "q" using command down`).
  If macOS refuses Accessibility for the terminal, say so in the note and describe the
  manual step; do not try to change system settings.

## Seams under test

The seam is the **packaged app's observable behaviour**: log lines on stderr and the
window's visible state, driven by real key events or by temporary commands invoked from
the WebView console. No unit test is written in this slice; the "red test" of each
question is the observation recorded in the note. Internals (coordinator fields) are
read only through logs, not asserted.

## Verify (from `/Users/avigano/orca/workspaces/open-todo/trevally-lifecycle-spike` or the
worktree Orca created)

```bash
pnpm install --frozen-lockfile
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" pnpm desktop:build
test -s docs/designs/lifecycle-spike.md && grep -c '^## Q' docs/designs/lifecycle-spike.md   # must print 5
git diff --stat HEAD~1 -- src-tauri/src/lib.rs   # SPIKE markers removed in the final commit, or listed in the note
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix. The
DMG step of `desktop:build` failed once transiently; the `.app` under
`src-tauri/target/release/bundle/macos/` is what the spike runs.

## Out of scope

- No changes to the coordinator's behaviour, the bridge, `CHANGELOG.md`, `VERSION`,
  `knowledge/**`, `docs/HANDOVER.md`.
- No new dependencies. No `machine.rs`/`runtime.rs` yet: that is slice 1.
- No attempt to fix anything observed; record it.

## Report

Per question: procedure, raw log excerpt, observed answer, table cell confirmed or
changed. Sabotage step of the standard prompt: not applicable to a spike; say so.
