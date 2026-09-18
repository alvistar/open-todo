# Fix plan for the slice-4 review findings

Source report: `docs/designs/lifecycle-slice-4-review.md`. Spec: `docs/designs/lifecycle-slice-4-plan.md`
and `lifecycle-state-machine.md` §5/§9. Base: HEAD of `alvistar/lifecycle-wiring`.

REASONING: xhigh

| ID | Location | Seam under test | Reproduction (what the red test asserts) | Cause hypothesis | Area |
|---|---|---|---|---|---|
| B1 | `tauri_runner.rs:128-132` `emit_error`, `:263-277` recreate failure | `TauriRunner::run` with mock app that has NO main window | `EmitError(msg)` with no main window today does nothing. Assert a native message dialog is requested instead (route the dialog through a small `Notifier` trait on the runner with a fake in tests: `emit_to_window(msg)` / `native_dialog(msg)`; the real one uses `app.dialog().message(..).kind(Error).show(|_| {})`). Second test: `Recreate(id)` whose build closure returns Err → `RecreationFinished{ok:false}` AND, because the machine then emits `EmitError` with no window, the native dialog path is taken. | The old `emit_recreation_error` dialog was deleted and `emit_error` requires a window. | runner |
| S1 | `tauri_runner.rs:139` `ShowWindow` | `TauriRunner::run` | `ShowWindow` must not call any wry getter from the loop thread (`is_visible`, `is_minimized`, …): the getters block on the main thread, which may itself be blocked in `exit_requested()`. Assert via the `Notifier`/window-ops trait fake that `ShowWindow` calls exactly `show` then `set_focus` (both non-blocking sends) and no getter. Also audit `on_activate` in lib.rs (`:146-162` `unminimize`+`show`+`focus`): it runs on the main thread, so getters there are fine, but keep it getter-free too for symmetry. | `is_visible()` guard added for tidiness; unsafe on the loop thread. | runner |
| S2 | `tauri_runner.rs:478-490` | test | Replace the vacuous `is_visible()==true` assertion with the S1 fake-ops assertion (show then set_focus, no getter). | MockRuntime hard-codes visibility. | tests |
| S3 | `tauri_runner.rs:109-110` Recreate ok path | `TauriRunner::run` with `with_recreate(|_| Ok(()))` | Exactly one `RecreationFinished{id, ok:true}` arrives and the channel is then empty (no second send from the Drop guard). | untested ordering | tests |
| S4 | `lib.rs` mapping tests | mapping fns with mock app + `spawn_loop` and a recording fake runner | Add: `on_close_requested` → a `Begin{Close, window_exists:true}` observed (and `prevent_close` called: if `CloseRequestApi` is unconstructable, split the fn so the decision part is testable, as done for exit); `RunEvent::Exit` → `Exited` observed; `on_activate` with a window present → no event and show+focus on the ops fake. | tests missing | tests |
| N1 | `tauri_runner.rs:116-120` | n/a | `ReplyToken` arm: log at debug only when the reply was actually dropped is impossible to know here; change the message to "ready token replied by the loop" so it is not misleading. | wording | runner |
| N2 | `tauri_runner.rs:199` | n/a | Remove the `#[cfg(not(test))]` around `save_window_state`; tolerate its `Err` with a `log::warn!` instead, so tested and shipped code coincide. | test-only divergence | runner |
| N3 | `tauri_runner.rs:57,65` + machine `EmitError` | n/a | On emit failure only the runner's notice should reach the bridge; since the machine's `EmitError` follows, make the runner skip its own `emit_error` in the `EmitFailed` path (the machine's message is the single notice). | double notice | runner |
| N4 | report | n/a | Record the single 5 s timeout constant as a follow-up in the worker_done report (the plan required it and the report omitted it). | omission | docs |

Deferred: the ask/grace timeout shape (`ScheduleTimeout{attempt, grace}`) is a machine change for a later slice; `mod.rs` allowances stay as they are.

## Checklist
- [ ] B1  - [ ] S1  - [ ] S2  - [ ] S3  - [ ] S4  - [ ] N1  - [ ] N2  - [ ] N3  - [ ] N4

## Out of scope
`machine.rs`, `runtime.rs`, `properties.rs`, `traces.rs`, `Cargo.toml`, the React bridge, geometry code, docs other than the report.

## Verify (from the worktree root)
```bash
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" pnpm desktop:build
```

## Existing tests that must stay green
All 88 tests; changing any assertion other than S2's needs a question first.
