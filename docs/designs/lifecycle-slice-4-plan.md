# Slice 4: wire the lifecycle machine into Tauri

Parent design: `docs/designs/lifecycle-state-machine.md` (§5 runtime, effect→event table,
§8 spike answers Q3 and Q5). Base: `3a3becc` on `alvistar/trevally`. Branch:
`alvistar/lifecycle-wiring`. Runs in parallel with slices 2 and 3: **touch only the files
listed here**; `machine.rs` is read-only (slice 2 owns it).

REASONING: xhigh

## Files and symbols in scope

- `src-tauri/src/lifecycle/tauri_runner.rs` (declared, `#![allow(dead_code)]` to remove):
  `TauriRunner<R: Runtime>` implementing `runtime::EffectRunner`, the wire-format structs,
  and its tests.
- `src-tauri/src/lib.rs`: `AppState` holds a `LifecycleHandle` instead of the mutex; the three
  commands, `CloseRequested`, `ExitRequested`, `Reopen`, `Exit`, single-instance activation and
  window recreation are mapped onto events; `finalize_attempt`, `schedule_recovery_timeout`,
  `show_native_recovery`, `send_lifecycle_request`, `emit_lifecycle_request`,
  `mark_frontend_unready`, `request_lifecycle` are deleted or moved into the runner. The old
  coordinator stays compiled and unused (`#[allow(dead_code)]` on its `use`s); slice 6
  deletes it. Geometry code is untouched.
- `src-tauri/src/lifecycle/mod.rs`: only remove the two `#[allow(dead_code)]` lines above
  `machine`/`runtime` once they are used, and the `#![allow(dead_code)]` in `tauri_runner.rs`.

## Interfaces

```rust
// tauri_runner.rs
use super::machine::{Attempt, Effect, Kind, RecreationId, Token};
use super::runtime::{EffectRunner, Envelope, LifecycleHandle};

/// Wire format of `lifecycle:request` and of the `lifecycle_decision` payload: identical to
/// what the bridge already sends and receives today (see `LifecycleAttempt` and
/// `LifecycleDecisionPayload` in lifecycle/mod.rs: camelCase `attemptId`, `generation`,
/// `kind` ("close"|"quit"), `requestSequence`; decision "allow"|"discard"|"cancel"|"exit-anyway",
/// `dirty`, `pending`). The bridge does not change.
#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct WireAttempt { pub attempt_id: u64, pub generation: u64, pub kind: WireKind, pub request_sequence: u64 }
#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct WireToken { pub instance_id: String, pub generation: u64 }
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
pub struct WireDecision { pub attempt_id: u64, pub generation: u64, pub request_sequence: u64,
                          pub decision: WireChoice, pub dirty: bool, pub pending: bool }
impl From<&Attempt> for WireAttempt; impl From<WireAttempt> for Attempt;
impl From<&Token> for WireToken;     impl From<WireToken> for Token;
impl From<WireDecision> for machine::Event;   // Event::Decide{..}

pub struct TauriRunner<R: tauri::Runtime> { app: tauri::AppHandle<R>, ask_timeout: Duration }
impl<R: tauri::Runtime> TauriRunner<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self;   // ask_timeout = 5 s for every ScheduleTimeout (grace and ask share it in this slice; see Notes)
}
impl<R: tauri::Runtime> EffectRunner for TauriRunner<R> {
    fn run(&mut self, effect: Effect, tx: &std::sync::mpsc::Sender<Envelope>);
}
```

Effect → action → completion event (the design's §5 table; every row ends in a send on `tx`
except where noted):

| Effect | Action | Completion |
|---|---|---|
| EmitRequest{a, f} | `main.emit("lifecycle:request", WireAttempt::from(&a))` | on `Err` or no main window: `EmitFailed{a, f}` then `EmitError` emit is attempted |
| ScheduleTimeout(a) | `std::thread::Builder::new().name("lifecycle-timeout").spawn(sleep ask_timeout; send Timeout(a))` | spawn `Err` → send `Timeout(a)` immediately |
| ShowRecoveryDialog(a) | `app.dialog().message(..).kind(Warning).buttons(OkCancelCustom("Exit anyway"/"Stay")).show(move |allow| send Recovered{a, allow})` — the callback API as in today's `show_native_recovery` | no main window / dialog cannot be built → send `Recovered{a, allow:false}` and emit `lifecycle:error` |
| ShowWindow | if main exists and `!is_visible().unwrap_or(true)` → `show()` + `set_focus()` | errors → `lifecycle:error` only |
| Finalize(a) | Close on macOS: `hide()` then `save_window_state`; Close elsewhere: `destroy()`; Quit: `app.exit(0)` (bypass was armed by the machine) | send `Finalized{a, ok}`; `lifecycle:error` on `ok:false`. For Quit the send happens before `exit` |
| ArmExitBypass(_) | nothing (state lives in the machine); `log::debug!` | none |
| Exit | `app.exit(0)` | `Exited` comes from `RunEvent::Exit` in lib.rs |
| AllowExit / PreventExit / ReplyToken | already answered by the loop; `log::debug!` | none |
| Recreate(id) | `std::thread::Builder` thread: build the main window exactly as today's `recreate_main_window` (geometry, window-state restore), with a `Drop` guard that sends `RecreationFinished{id, ok:false}` unless the success path sent `ok:true` first | as stated |
| EmitError(msg) | `main.emit("lifecycle:error", LifecycleDiagnostic{message})`, ignore errors | none |
| Log(reason) | `log::debug!` | none |

lib.rs mapping (all through `state.lifecycle: LifecycleHandle`):

- `lifecycle_ready(instance_id) -> Result<WireToken, String>`: `handle.ready(instance_id)`
  mapped to `WireToken`; `Err` → string.
- `lifecycle_unready(token: WireToken)`: `handle.send(FrontendUnready{token})`.
- `lifecycle_decision(payload: WireDecision)`: `handle.send(payload.into())`.
- `CloseRequested` on main: `api.prevent_close()`; `handle.send(Begin{Close, window_exists:true})`.
- `ExitRequested`: `match handle.exit_requested() { Prevent => api.prevent_exit(), Allow => {} }`.
  The machine's `Idle × ExitRequested` without bypass composes `Begin(Quit)` itself, so lib.rs
  sends nothing else.
- `Reopen` and single-instance activation: main window exists → `show`+`set_focus` (as today);
  no main window → `handle.send(RecreationStarted)`.
- `RunEvent::Exit` → `handle.send(Exited)`; then the existing exit logging.
- `AppState { lifecycle: LifecycleHandle }` built in `setup` with
  `spawn_loop(Machine::new(0), TauriRunner::new(app.handle().clone()))`.

## Notes and decisions taken here

- One 5 s constant for both grace and ask timeouts: the effect does not say which state armed
  it and `machine.rs` is not in scope. Recorded as a follow-up for the coordinator (a
  `ScheduleTimeout{attempt, grace: bool}` shape) in the report.
- Spike Q3: `hide`/`show`/`destroy` work from a worker thread; the loop thread calls them
  directly, no `run_on_main_thread`.
- Spike Q5: `app.exit(0)` returns; the second `ExitRequested` is answered by the machine.

## Seams under test

- `TauriRunner::run` with `tauri::test::mock_builder()` (the `test` feature is already a
  dev-dependency): build a mock app with a `main` webview window, create the runner and a
  channel, call `run` per effect, assert the event that arrives on the receiver and the
  window state (`is_visible` after `ShowWindow`/`Finalize(Close)`). Rows to cover: every row of
  the table above that has a completion; `Recreate` with a runner whose build closure panics
  → `RecreationFinished{ok:false}` (inject the failure through a test-only constructor
  `TauriRunner::with_recreate(|app| -> Result<()>)`); `ScheduleTimeout` with
  `ask_timeout = 10 ms` in tests.
- Wire conversions: round-trip tests `WireAttempt` ↔ `Attempt`, `WireDecision` → `Event`,
  with the JSON the bridge sends today (copy a literal from `src/lifecycle/useDesktopLifecycle.tsx`).
- lib.rs mapping: extract the handlers into small functions taking `&LifecycleHandle` and the
  tauri objects (`on_close_requested`, `on_exit_requested`, `on_activate`), and test them with
  the mock app plus a `spawn_loop` whose runner is a fake that records effects: `ExitRequested`
  without bypass → `Prevent` and a `Begin(Quit)` observed; with bypass armed (drive the machine
  through `Idle{hidden_by_close}`, i.e. Finalize(Close) ok then Begin(Quit)) → `Allow`.
- NOT tested here: the packaged app (slice 5), `machine.rs` cells, proptest, the old
  coordinator.

## Verify (from the worktree root)

```bash
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" pnpm desktop:build
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix. The DMG
step of `desktop:build` failed once transiently; if it fails, rerun once and report.

## Out of scope

`machine.rs`, `runtime.rs`, `properties.rs`, `traces.rs`, the old coordinator's code (leave it
compiled), the React bridge, `Cargo.toml`, geometry functions, docs, `CHANGELOG.md`, `VERSION`.
Do not run the packaged app interactively; the build must succeed, the smoke is slice 5.

## Slices for the TDD loop (one commit each)

1. Wire structs and conversions with the round-trip tests.
2. `TauriRunner` rows: EmitRequest, EmitError, Log, ShowWindow, ShowRecoveryDialog (mock).
3. `TauriRunner` rows: Finalize (Close hide/destroy, Quit), ScheduleTimeout, Recreate with the
   `Drop` guard.
4. lib.rs: `AppState` with the handle, commands, handlers extracted and tested; old helpers
   removed; `dead_code` allowances removed where no longer needed.
5. `pnpm desktop:build` green; report the follow-up on the timeout shape.
