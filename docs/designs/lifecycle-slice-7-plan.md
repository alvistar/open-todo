# Slice 7: every quit path reaches the machine, and the ask waits for the person

Parent design: `docs/designs/lifecycle-state-machine.md` (§2 shape, §3 table, §5 runtime).
Evidence: `docs/designs/lifecycle-slice-5-smoke.md` (findings S5-1 and S5-2). Base:
`a52dce8` on `alvistar/trevally`. Branch: `alvistar/lifecycle-quit-paths`. Read the smoke
report's "Coordinator's reading" section first: it states both defects and their cause.

REASONING: max

## The two defects, in one sentence each

- **S5-1.** open-todo sets no menu, so Tauri's default menu is used; its Quit item is the AppKit
  selector `terminate:` (muda 0.17.2, `platform_impl/macos/mod.rs:992`), which asks the app
  delegate `applicationShouldTerminate:`; tao implements no such method, so the process ends and
  the machine sees only `Exited`. ⌘Q, File → Quit, Dock → Quit, App Switcher and
  `osascript … to quit` all lose a dirty draft. `RunEvent::ExitRequested` is raised only by
  `AppHandle::exit(n)` and by the last window's destruction.
- **S5-2.** The bridge shows its close dialog and waits for a click without telling the shell,
  so the 5 s ask timeout fires while the person is reading and the native "did not respond"
  dialog appears with "Close anyway" as its default button.

## Files and symbols in scope

- `src-tauri/src/lifecycle/terminate.rs` (new): the `applicationShouldTerminate:` delegate
  method added at runtime to tao's live app delegate, macOS only, and the pure reply mapping.
- `src-tauri/src/lifecycle/mod.rs`: `pub mod terminate;` only.
- `src-tauri/src/lifecycle/machine.rs`: `Event::Acknowledged`, the `acknowledged` flag on
  `State::Asking`, the cells below, scenario tests `s7_…`.
- `src-tauri/src/lifecycle/properties.rs`: `arb_event` / `event_from_seed` produce
  `Acknowledged` (valid and stale); existing invariants must stay green at 10 000 cases.
- `src-tauri/src/lifecycle/traces.rs`: compile only (`State::Asking` gains a field; adjust
  patterns; no old call maps to `Acknowledged`, say so in the mapping comment).
- `src-tauri/src/lifecycle/tauri_runner.rs`: `impl From<WireAttempt> for Event` is NOT the
  shape (an attempt is not an event); add `pub fn acknowledged_event(attempt: WireAttempt) -> Event`.
- `src-tauri/src/lib.rs`: command `lifecycle_acknowledge`, its registration in
  `generate_handler!`, `terminate::install(app.handle())` in `setup` after `AppState` is managed.
- `src-tauri/Cargo.toml`: `[target.'cfg(target_os = "macos")'.dependencies] objc2 = "=0.6.4"`.
  Nothing else (no objc2-app-kit, no dispatch2: the reply is synchronous, see below).
- `src/lifecycle/useDesktopLifecycle.tsx` and `useDesktopLifecycle.test.tsx`: the
  acknowledgement invoke and its tests.
- `docs/designs/lifecycle-state-machine.md`: §2 event list, §3 `Asking` row and the new
  `Acknowledged` column, §5 effect→event table (a new "bridge → event" row), and a §10 entry
  "Slice 7" with the two findings. Keep the table's cell style.

## Interfaces

```rust
// machine.rs
pub enum Event {
    …,
    /// The bridge mounted its dialog for this request and is waiting for the person.
    /// Owner tuple as in `Decide`; a mismatch is stale.
    Acknowledged { attempt_id: u64, generation: u64, sequence: u64 },
}
pub enum State {
    …,
    /// `acknowledged`: the bridge confirmed the current (attempt, sequence). While true the
    /// ask has no timeout: a person is deciding. Every re-emit (recheck, supersede, new
    /// frontend) resets it to false and arms a new timeout.
    Asking { attempt: Attempt, frontend: Token, recreate_pending: bool, acknowledged: bool },
}
```

Cells (everything else unchanged; the `Acknowledged` column reads `Log(stale)` in every other
state):

| State × Event | Result |
|---|---|
| `Asking{a, f, rp, _} × Acknowledged` matching `a` (id, generation, sequence) | `Asking{a, f, rp, acknowledged: true}`, `[Log("acknowledged")]` |
| `Asking{…} × Acknowledged` not matching | `[Log("stale")]` |
| `Asking{a, …, acknowledged: true} × Timeout(a)` | state unchanged, `[Log("acknowledged; waiting for the person")]` — no dialog, no EmitError |
| `Asking{…, acknowledged: false} × Timeout(a)` | as today |
| every transition that emits a new `EmitRequest` from or into `Asking` (recheck `a.seq+1`, supersede Close→Quit, `FrontendReady` with a new token) | `acknowledged: false` in the new state, `ScheduleTimeout` as today |
| `Asking{…, acknowledged: true} × Decide` matching | as today (the flag is dropped with the state) |

```rust
// terminate.rs — macOS only; a no-op module elsewhere.
/// AppKit's `NSApplicationTerminateReply`. `Later` is deliberately absent: this design
/// answers synchronously and lets the machine's own `Exit` effect end the process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminateReply { Cancel = 0, Now = 1 }

/// Pure: the machine's verdict on a blocking `exit_requested()` round-trip.
/// `Allow` → `Now` (bypass was armed: the machine already decided). `Prevent` → `Cancel`:
/// the machine has begun a Quit attempt (`Idle × ExitRequested` composes `Begin(Quit)`),
/// and an authorised quit ends in `Effect::Exit` → `app.exit(0)` → a second
/// `ExitRequested` answered `Allow`. AppKit is told nothing more.
pub(crate) fn reply_for(verdict: super::runtime::ExitVerdict) -> TerminateReply;

/// Adds `applicationShouldTerminate:` to the class of NSApp's live delegate via
/// `class_addMethod` (objc2 ffi), storing the handle in a `OnceLock<AppHandle>`; the method
/// calls `state.lifecycle.exit_requested()` and maps it with `reply_for`. Logs
/// `lifecycle: applicationShouldTerminate installed` on success; `log::error!` when the
/// class already defines the selector (a newer tao) or NSApp has no delegate. Idempotent.
pub(crate) fn install(app: &tauri::AppHandle);
```

Port the ObjC glue from `/Users/avigano/Developer/ai-review/margins-app/src-tauri/src/quit/terminate.rs`
(read it: `SHOULD_TERMINATE_TYPES = c"L@:@"`, `extern "C-unwind" fn`, `AnyClass::get(c"NSApplication")`,
`msg_send![.., sharedApplication]`, `.., delegate]`, `class_addMethod`). Drop its `reply`
function and `dispatch2`: not needed here. Keep the comments' substance in your own words.

```rust
// lib.rs
#[tauri::command]
fn lifecycle_acknowledge(state: State<'_, AppState>, attempt: WireAttempt) {
    state.lifecycle.send(lifecycle::tauri_runner::acknowledged_event(attempt));
}
```

```ts
// useDesktopLifecycle.tsx — once per (attemptId, requestSequence), when the dialog is about
// to render (request present and dirty || pending). Fire-and-forget; errors ignored.
void invoke("lifecycle_acknowledge", { attempt: request });
```

The payload is the `LifecycleAttempt` the bridge received, unchanged (camelCase
`attemptId`, `generation`, `kind`, `requestSequence`), so `WireAttempt` deserializes it.

## Seams under test

- `Machine::step` (as every scenario test): `s7_ack_disarms_timeout` (Begin, ready, ack,
  Timeout → still Asking, no `ShowRecoveryDialog`, then Decide cancel → Idle);
  `s7_stale_ack_is_logged` (ack with the previous sequence); `s7_recheck_needs_a_new_ack`
  (ack, Decide allow with dirty → `a.seq+1`, Timeout → Recovering: the old ack does not
  carry over); `s7_ack_outside_asking_is_stale` (Idle, AwaitingFrontend, Recovering).
- `properties.rs`: `event_from_seed` yields `Acknowledged` with the live owner tuple and with
  a wrong one; all six invariants at 10 000 cases. Report the case count.
- `terminate::reply_for` unit tests (both verdicts). The ObjC `install` has no seam under
  `cargo test` (no NSApplication): it is verified by the packaged smoke the coordinator runs
  after the merge. Do not mock it.
- `lib.rs` mapping test with the mock runtime and a fake runner (the existing pattern in
  `lib.rs` tests): `lifecycle_acknowledge` sends `Event::Acknowledged` with the wire ids.
- Bridge (Vitest, `useDesktopLifecycle.test.tsx`, existing mocks): with a dirty source, a
  request triggers exactly one `invoke("lifecycle_acknowledge", { attempt })` with the
  request's ids before any decision; a clean request auto-allows and never acknowledges; a
  second request with a new `requestSequence` acknowledges again.
- NOT tested here: the packaged app, the old coordinator, timing with real clocks.

## Verify (from the worktree root)

```bash
pnpm check
pnpm test src/lifecycle
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" PROPTEST_CASES=10000 cargo test --manifest-path src-tauri/Cargo.toml -- lifecycle::properties
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" pnpm desktop:build
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix. Clippy
exits 0 on warnings without `-D warnings`; the flag is mandatory. The DMG step of
`desktop:build` failed once transiently; rerun once if it fails and report.

## Out of scope

The old coordinator in `lifecycle/mod.rs` (compiled, unused, slice 6 deletes it), `runtime.rs`,
a custom application menu (the default menu stays; `terminate:` now reaches the machine),
`NSTerminateLater`, the 2 s grace / 5 s ask split, `CHANGELOG.md`, `VERSION`, `knowledge/**`,
`docs/HANDOVER.md`, `.claude/skills/**`. Do not run the packaged app interactively; the
build must succeed, the smoke is the coordinator's.

## Slices for the TDD loop (one commit each)

1. `machine.rs`: `Acknowledged`, the `acknowledged` flag, the cells, the four `s7_` scenarios
   (red first on `s7_ack_disarms_timeout`); `properties.rs` and `traces.rs` compile and pass.
2. `tauri_runner.rs` `acknowledged_event`, `lib.rs` command + mapping test.
3. Bridge: the acknowledgement invoke and its three Vitest cases.
4. `terminate.rs`: `reply_for` with tests, `install`, `Cargo.toml`, `setup` wiring; `desktop:build` green.
5. `docs/designs/lifecycle-state-machine.md` updated as listed above.
