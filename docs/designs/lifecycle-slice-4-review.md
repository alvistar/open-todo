# Slice-4 review: Tauri wiring vs plan

Independent read-only review (Opus, medium) of `84059de..2d90929` on `alvistar/lifecycle-wiring`.

# Spec-vs-Standards review — slice 4 (lifecycle wiring)

**VERDICT: NOT READY — one blocker (silent recreation failure regression), four should-fixes.**

## Findings

### Blocker

**B1 — A failed window recreation is now completely silent.**
`src-tauri/src/lifecycle/tauri_runner.rs:263-277` (`recreate_main_window`) only `log::error!`s on failure; the machine's compensating `Effect::EmitError("lifecycle recreation failed")` (`machine.rs:1161`) reaches `TauriRunner::emit_error` (`tauri_runner.rs:128-132`), which **requires a main window to emit** — and recreation failed precisely because there is none. The old code showed a native modal: `emit_recreation_error` at old `lib.rs:479-487` (`app.dialog()…MessageDialogKind::Error`), deleted in this diff with nothing replacing it. The parent design's failure table (§9 "rebuild thread / panic before finish") promises "User sees: error notice". Net effect: the app has no window, no dock response, no message. Fix in the runner: in `EmitError`, fall back to a native dialog when `get_webview_window(MAIN_WINDOW)` is `None` (or restore `emit_recreation_error` on the `Recreate` error path). No test covers it.

### Should-fix

**S1 — Deadlock window: `is_visible()` blocks the loop thread on the main thread.**
`tauri_runner.rs:139` calls `window.is_visible()` from the loop thread. In `tauri-runtime-wry-2.11.4/src/lib.rs:197-210`, every window *getter* is `send_user_message` + `rx.recv()` with no timeout, serviced only by the main event loop. Meanwhile the main thread blocks on the loop in `on_exit_requested` (`lib.rs:136-144` → `LifecycleHandle::exit_requested`, `runtime.rs:65-78`, untimed `recv`) and in the sync command `lifecycle_ready` (`lib.rs:26`, sync `#[tauri::command]` runs inline on the IPC/main thread). If ⌘Q or a bridge `lifecycle_ready` lands while the loop is inside `is_visible()`, both threads wait forever. Every other loop-thread native call is safe: `show`/`hide`/`set_focus`/`destroy`/`emit` go through the non-blocking `send_user_message` branch, and `AppHandle::exit` is non-blocking (`request_exit`, wry `lib.rs:2748-2755`) — so this is the only offender. Cheapest fix: drop the `is_visible()` guard and call `show()` + `set_focus()` unconditionally (both are idempotent, non-blocking sends). Effect ordering is otherwise correct — `ReplyToken` and `AllowExit`/`PreventExit` are always at index 0 (`machine.rs:284, 310, 406, 452, 733, 843, 1002, 1189, 1226`), and `run_loop` sends the reply before running that effect, so no other stall is reachable. Spike Q3 does not cover this: it covered `show`/`hide`/`destroy`, not a getter.

**S2 — `ShowWindow` test is vacuous.** `tauri_runner.rs:478-490` asserts `window.is_visible()` is true, but `MockRuntime` hard-codes `is_visible() == true` and `hide()` as a no-op — as the comment at `:536` itself admits for `Finalize`. The test cannot fail and covers nothing.

**S3 — `Recreate` ok path untested.** Only the panic/Drop-guard path is tested (`tauri_runner.rs:604-620`). The `ok:true` ordering (`send_event` then `guard.completed = true`, `tauri_runner.rs:109-110`) — the exact line preventing a double `RecreationFinished` — has no test. `with_recreate(|_| Ok(()))` asserting exactly one `ok:true` and then an empty channel is two lines.

**S4 — lib.rs mapping tests miss three of the five mappings.** No test for `on_close_requested` (named in the plan's seams list), for `RunEvent::Exit → Exited`, or for `on_activate` **with** a window (show+focus, no event). `on_exit_requested`'s `api.prevent_exit()` is untested too — the tests call the pass-through `on_exit_verdict` (`lib.rs:142-144`), a wrapper that exists only to dodge the unconstructable `ExitRequestApi`.

### Nits

- `tauri_runner.rs:116-120`: the `ReplyToken` arm logs "lifecycle ready reply dropped" on **every** successful ready — `run_loop` answers the oneshot and then still calls `runner.run(effect)`. Misleading log.
- `tauri_runner.rs:199` `#[cfg(not(test))]` around `save_window_state` makes tested code differ from shipped code on the macOS close path; a tolerated `Err` would have been equivalent.
- Machine-authored `EmitError` strings ("lifecycle request emission failed") are forwarded verbatim to `setNativeError` (`src/lifecycle/useDesktopLifecycle.tsx:93-94`) and rendered to the user. On emit failure the user now gets two notices (the runner's sentence at `tauri_runner.rs:57/65`, then the machine's dev string), last one wins.
- `mod.rs:1` keeps `#[allow(dead_code)]` on `machine` (re-justified as test-facing accessors) where the plan said to remove it; `mod.rs:8` merged two unrelated comments onto the `traces` line.
- Timeout follow-up owed: one 5 s `ask_timeout` (`tauri_runner.rs:33`) serves both the 2 s grace and the 5 s ask of parent §5. The plan authorises this but requires it be reported; it must land in the report/CHANGELOG.

## Effect table, row by row

| Row | Result |
|---|---|
| EmitRequest ok | match — `window.emit("lifecycle:request", WireAttempt)` `tauri_runner.rs:60-62`, no completion |
| EmitRequest err / no window | match — `EmitFailed{attempt, frontend}` carries the same values (`:56`, `:64`), then `emit_error`; note the no-window case's error emit is a no-op |
| ScheduleTimeout | match — `thread::Builder::new().name("lifecycle-timeout")` `:72-77`; spawn `Err` → immediate `Timeout(a)` `:78-80` |
| ShowRecoveryDialog | match — callback dispatches `Recovered{a, allow}` `:186-188`; no-window → `Recovered{allow:false}` + error `:152-162`; dialog body moved verbatim from old `show_native_recovery` (labels "Close/Exit anyway"/"Cancel", not the plan's "Stay" — old behaviour preserved, plan text was wrong) |
| ShowWindow | match on behaviour `:134-149`; see S1 (blocking getter) and S2 (vacuous test) |
| Finalize Close-macOS | match — `hide()` then `save_window_state` `:197-206` |
| Finalize Close-other | match — `destroy().is_ok()` `:215` |
| Finalize Quit | match — `Finalized{ok:true}` sent **before** `app.exit(0)` `:221-229` |
| Finalize err | match — `Finalized{ok:false}` + `emit_error` `:232-235` |
| ArmExitBypass | match — `log::debug!` only `:87-89` |
| Exit | match — `app.exit(0)` `:90`, `Exited` from `RunEvent::Exit` |
| AllowExit / PreventExit / ReplyToken | match — debug logs `:91-92`, `:116-120` (see nit) |
| Recreate | match — `thread::Builder` `:97`, `RecreationGuard` Drop sends `ok:false` `:249-261`, `completed = true` only after the `ok:true` send `:109-110`, spawn err → immediate `ok:false` `:112-114`. **Divergence:** the failure path lost the user-facing dialog (B1) |
| EmitError | partial — `:121`, `:128-132`; silently drops when no window exists (B1) |
| Log | match — `:122` |

## lib.rs mapping

| Item | Result |
|---|---|
| `lifecycle_ready` → `handle.ready` → `WireToken` | match `lib.rs:26-32` |
| `lifecycle_unready` → `FrontendUnready{token}` | match `:35-39` |
| `lifecycle_decision` → `payload.into()` | match `:42-44` |
| CloseRequested → `prevent_close` + `Begin{Close, window_exists:true}` | match `:128-134`; untested (S4) |
| ExitRequested → verdict; `Prevent` → `prevent_exit`, `Allow` → nothing; no extra `Begin` | match `:136-140`; the `Begin(Quit)` is composed inside `machine.rs:302-311` |
| Reopen / single-instance | match `:146-162` — unminimize+show+focus when present, `RecreationStarted` when not |
| `RunEvent::Exit` → `Exited` | match `:116-119`; untested |
| `AppState { lifecycle }`, `spawn_loop(Machine::new(0), TauriRunner::new(..))` in `setup` | match `:21-23`, `:69-72` |
| Old coordinator / Mutex | clean — `LifecycleCoordinator` appears nowhere in `lib.rs`; no `Mutex` in production code; all seven named helpers (`finalize_attempt`, `schedule_recovery_timeout`, `show_native_recovery`, `send_lifecycle_request`, `emit_lifecycle_request`, `mark_frontend_unready`, `request_lifecycle`) are gone; the coordinator stays compiled behind `#[allow(dead_code)]` in `mod.rs` as the plan requires |

## Wire format

No mismatch. `WireAttempt` → `{attemptId, generation, kind:"close"|"quit", requestSequence}` (`tauri_runner.rs:295-302`, `279-284`) matches `LifecycleRequest` in `src/lifecycle/requestState.ts:2-5`. `WireToken` → `{instanceId, generation}` matches `FrontendToken` (`useDesktopLifecycle.tsx:29-30`). `WireDecision` accepts `{attemptId, generation, requestSequence, decision, dirty, pending}` with kebab-case choices — `"allow"|"discard"|"cancel"|"exit-anyway"` — matching the payload built at `useDesktopLifecycle.tsx:144-149`. Command arg names (`instanceId`, `token`, `payload`) and event names (`lifecycle:request`, `lifecycle:error` with `{message}`) are unchanged, and the emit still targets the main `WebviewWindow` exactly as the old `emit_lifecycle_request` did.

## Out-of-scope check

Respected. `git diff --stat 84059de..HEAD` touches exactly `src-tauri/src/lib.rs`, `src-tauri/src/lifecycle/tauri_runner.rs`, `src-tauri/src/lifecycle/mod.rs`. `machine.rs`, `runtime.rs`, `properties.rs`, `traces.rs`, `Cargo.toml`, the React bridge and the geometry functions (`ensure_usable_geometry`, `monitor_intersects`, `rectangles_have_usable_intersection`, `geometry_tests`) are untouched.