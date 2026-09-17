# Design: the desktop lifecycle coordinator as an explicit state machine

Status: reviewed 2026-09-17 (/plan-eng-review D1–D6 and outside-voice decisions D9–D14
applied; see GSTACK REVIEW REPORT). Replaces the field-based `LifecycleCoordinator` in
`src-tauri/src/lifecycle.rs` after five review passes
(`tauri-desktop-shell-review.md` … `-review-5.md`) each found a new race next to the
previous fix. Outside voice: Codex gpt-5.6-sol, output recorded in the review report.

## 1. Why

The coordinator arbitrates between native window events (close button, ⌘Q, Dock
reopen) and the React bridge, which alone knows whether a draft or a pending write
must be protected. Today its state is nine independent fields:

```
frontend_instance, active, active_frontend, recovery_attempt, finalizing,
pending_kind, recreation_in_progress, exit_bypass_generation, generation
```

The valid combinations are written nowhere. Every fix since round 2 added a gate on
one field and forgot a combination on another; each time a *legitimate* event fell
through a silent `return` (review-3 NEW-1, review-4 B1, review-5 B1′). The defect
class is structural: implicit state plus early returns with no outcome, plus a mutex
released between a decision and its native action (review-5 S1).

The replacement makes three things impossible by construction:

1. **An unhandled (state, event) pair.** One `enum` for the state, one `match` over
   `(State, Event)`; the compiler enforces exhaustiveness.
2. **A silent drop.** `step` returns effects. An event that changes nothing returns
   `Effect::Log(reason)`. A property test asserts it.
3. **Re-entrancy.** One thread owns the machine and runs effects in the order the
   transition emitted them. There is no mutex and no recursive dispatch (D14).

## 2. Shape

New module `src-tauri/src/lifecycle/machine.rs` (pure, no Tauri types) and
`src-tauri/src/lifecycle/runtime.rs` (the event loop and effect runner). `lib.rs`
maps Tauri events and commands onto the loop's channel and owns no lifecycle logic.

```rust
pub enum Kind { Close, Quit }

pub struct Attempt { id: u64, generation: u64, kind: Kind, sequence: u64 }
pub struct Token   { instance_id: String, generation: u64 }   // minted by the machine
pub struct RecreationId(u64);

pub enum State {
    /// Nothing in flight. `hidden_by_close` is true only after an authorised close
    /// hid the window in this generation (D11): the draft decision was taken then.
    Idle { hidden_by_close: bool },
    /// An intent exists but no bridge of this generation has reported ready yet
    /// (a ⌘Q right after launch, or a quit queued across a window rebuild). A grace
    /// timeout is armed; the bridge's ready turns this into Asking. (D1, D4)
    AwaitingFrontend { attempt: Attempt, recreate_pending: bool },
    /// The bridge `frontend` was asked; an ask timeout is armed.
    Asking { attempt: Attempt, frontend: Token, recreate_pending: bool },
    /// No usable bridge; the native recovery dialog is open for `attempt`.
    /// `upgrade_to_quit` records a ⌘Q pressed while a Close dialog is open.
    Recovering { attempt: Attempt, upgrade_to_quit: bool, recreate_pending: bool },
    /// The native action for `attempt` is executing (hide / destroy).
    Finalizing { attempt: Attempt, queued_quit: bool, recreate_pending: bool },
    /// The main window is being rebuilt. `reserved` is the generation the new
    /// window will have (D12); `ready` is a bridge that reported before the build
    /// completed, already minted in `reserved`.
    Recreating { id: RecreationId, reserved: u64, queued_quit: bool, ready: Option<Token> },
    /// `app.exit` was called; only `ExitRequested` (bypass) and `Exited` are
    /// expected. Nothing else can start. (D10/8)
    Exiting { attempt: Option<Attempt>, generation: u64 },
}

pub struct Machine {
    state: State,
    generation: u64,
    next_attempt: u64,
    next_recreation: u64,
    frontend: Option<Token>,     // last bridge that reported ready in this generation
    exit_bypass: Option<u64>,    // armed by ArmExitBypass; consumed by ExitRequested
}

pub enum Event {
    Begin { kind: Kind, window_exists: bool },
    Decide { attempt_id, generation, sequence, decision, dirty, pending },
    Finalized { attempt: Attempt, ok: bool },               // D10/7
    FrontendReady { instance_id: String },                  // bridge API unchanged (D12)
    FrontendUnready { token: Token },
    EmitFailed { attempt: Attempt, frontend: Token },       // D9/6
    Timeout(Attempt),
    Recovered { attempt: Attempt, allow: bool },            // from the dialog callback
    RecreationStarted,                                      // interpreter has no window
    RecreationFinished { id: RecreationId, ok: bool },
    ExitRequested,                                          // RunEvent::ExitRequested
    Exited,                                                 // RunEvent::Exit
}

pub enum Effect {
    EmitRequest { attempt: Attempt, frontend: Token },      // lifecycle:request
    ScheduleTimeout(Attempt),                               // grace or ask delay
    ShowRecoveryDialog(Attempt),                            // callback → Recovered
    ShowWindow,                                             // before asking a hidden window (D11)
    Finalize(Attempt),                                      // hide / destroy → Finalized{ok}
    ArmExitBypass(u64),                                     // always precedes Exit / destroy (D9/5)
    Exit,                                                   // app.exit(0)
    AllowExit,                                              // ExitRequested: let the exit proceed
    PreventExit,                                            // ExitRequested: api.prevent_exit()
    Recreate(RecreationId),                                 // build thread → RecreationFinished
    ReplyToken(Token),                                      // answer to lifecycle_ready
    EmitError(String),                                      // lifecycle:error to the bridge
    Log(&'static str),                                      // consumed, no change, why
}

impl Machine {
    pub fn step(&mut self, event: Event) -> Vec<Effect>;
}
```

Rules that hold in every arm:

- A `Decide`, `Timeout`, `Recovered`, `Finalized`, `EmitFailed` or `RecreationFinished`
  whose attempt tuple (id, generation, sequence) or recreation id does not match the
  one carried by the current state is **stale**: `Log`, no change. Full-tuple equality
  is the only staleness test.
- `FrontendReady` mints `Token{instance_id, generation}` in the current generation, or
  in `reserved` while `Recreating`. `FrontendUnready` with a token of another generation
  is `Log`.
- Every arm returns at least one effect. `step` never returns an empty vector.
- `frontend` is recorded in every state; whether to ask it is decided only on entry to
  `Asking`.
- Every asynchronous operation carries its owner: an `Attempt` (timeouts, dialog,
  finalisation, emissions) or a `RecreationId`. Invariants count completions
  (`Finalized{ok:true}`, `Exited`, `RecreationFinished{ok:true}`), not emitted effects
  (D10/10).
- The direct-exit path exists only from `Idle{hidden_by_close: true}` or when
  `window_exists == false` (D11). A hidden window whose bridge is alive is asked, after
  `ShowWindow`.

## 3. Transition table

Rows are states, columns are events. `→X` is the next state; effects follow in order.
"stale" means the owner tuple does not match: `Log`. `rp` = `recreate_pending`.
Composition: when a transition lands in `Idle` with `rp == true`, the same step
continues as `Idle × RecreationStarted` and appends those effects (D13); when it lands
in `Idle` from `Finalizing{queued_quit: true, ok: true}` it continues as
`Idle{hidden_by_close: true} × Begin(Quit)` (D2).

| State \ Event | Begin(kind, exists) | Decide | Finalized{ok} | FrontendReady | FrontendUnready | EmitFailed | Timeout | Recovered | RecreationStarted | RecreationFinished{id, ok} | ExitRequested | Exited |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Idle{hbc}** | Quit & (!exists ∨ hbc) → **Exiting{None}**, ArmExitBypass(gen), Exit. Close & !exists: Log(no window). Else new attempt a: `frontend` Some → **Asking{a, f, rp:false}**, (ShowWindow if hbc), EmitRequest{a,f}, ScheduleTimeout(a); `frontend` None → **AwaitingFrontend{a, rp:false}**, ScheduleTimeout(a) | Log(stale) | Log(stale) | mint t; record; ReplyToken(t); Log | clear if equal; Log | Log(stale) | Log(stale) | Log(stale) | id=next; → **Recreating{id, reserved: gen+1, queued_quit:false, ready:None}**, Recreate(id) | Log(stale) | bypass==Some(gen) → clear, AllowExit. Else: PreventExit, then as Begin(Quit, exists:true) | Log(unexpected) |
| **AwaitingFrontend{a, rp}** | Close: Log(dup). Quit & a.Close → a′ = a{Quit, seq+1}; → **AwaitingFrontend{a′, rp}**, ScheduleTimeout(a′) (D9/1). Quit & a.Quit: Log(dup) | Log(stale) | Log(stale) | mint t; record; ReplyToken(t); → **Asking{a.seq+1, t, rp}**, EmitRequest, ScheduleTimeout | clear if equal; Log | Log(stale) | ≠a: Log. ==a → **Recovering{a, false, rp}**, ShowRecoveryDialog(a) | Log(stale) | → same state with rp:true, Log(queued) | Log(stale) | PreventExit, then as Begin(Quit) | Log(unexpected) |
| **Asking{a, f, rp}** | Close: Log(dup). Quit & a.Close → supersede: a′ new Quit attempt → **Asking{a′, f, rp}**, EmitRequest{a′,f}, ScheduleTimeout(a′) (old a stale by tuple). Quit & a.Quit: Log(dup) | ≠a: Log. Cancel → **Idle{false}** (+rp composition). Allow&(dirty∨pending) ∨ Discard&pending → **Asking{a.seq+1, f, rp}**, EmitRequest, ScheduleTimeout (recheck). Otherwise authorised: Close → **Finalizing{a, false, rp}**, (ArmExitBypass on non-macOS), Finalize(a); Quit → **Exiting{a}**, ArmExitBypass(gen), Exit | Log(stale) | mint t; record; ReplyToken(t); t==f: Log. t≠f → **Asking{a.seq+1, t, rp}**, EmitRequest{·,t}, ScheduleTimeout | t==f: clear `frontend`, keep Asking, Log (timeout will recover). else Log | {a,f} match → clear `frontend`, keep Asking, EmitError, Log. else Log(stale) | ≠a: Log. ==a: `frontend`==Some(f) → **Recovering{a,false,rp}**, EmitError, ShowRecoveryDialog; `frontend`==Some(other) → **Asking{a.seq+1, other, rp}**, EmitRequest, ScheduleTimeout; None → **Recovering{a,false,rp}**, ShowRecoveryDialog | Log(stale) | rp:true, Log(queued) | Log(stale) | PreventExit, then as Begin(Quit) | Log(unexpected) |
| **Recovering{a, up, rp}** | Close: Log(dup). Quit & a.Close → up:true, Log(upgraded). Quit & a.Quit: Log(dup) | Log(stale: dialog owns a) | Log(stale) | mint; record; ReplyToken; Log(dialog is the authority) | clear if equal; Log | Log(stale) | Log(stale) | ≠a: Log. allow: a′ = a with Quit if up; Close → **Finalizing{a′, false, rp}**, Finalize; Quit → **Exiting{a′}**, ArmExitBypass, Exit. !allow → **Idle{false}** (+rp) | rp:true, Log(queued) | Log(stale) | PreventExit, then as Begin(Quit) | Log(unexpected) |
| **Finalizing{a, qq, rp}** | Quit → qq:true, Log(queued). Close: Log(finalizing) | Log(stale) | ≠a: Log. ok:true → **Idle{hidden_by_close: a.Close}**; qq → compose Begin(Quit) (→ Exiting); else rp composition. ok:false → **Idle{false}**, EmitError; qq → compose Begin(Quit, exists) through the normal path (D10/7); rp composition | mint; record; ReplyToken; Log | clear if equal; Log | Log(stale) | Log(stale) | Log(stale) | rp:true, Log(queued) | Log(stale) | PreventExit, then Log(finalizing; quit queued) with qq:true | Log(unexpected) |
| **Recreating{id, res, qq, ready}** | Quit → qq:true, Log(queued). Close: Log(no window) | Log(stale) | Log(stale) | mint t in `res`; ready:Some(t); ReplyToken(t); Log | clear ready if equal; Log | Log(stale) | Log(stale) | Log(stale) | Log(already recreating) | ≠id: Log(stale). ok: gen=res, `frontend`=ready; qq → new Quit attempt: ready Some → **Asking**, EmitRequest, ScheduleTimeout; ready None → **AwaitingFrontend**, ScheduleTimeout (D4/D12); !qq → **Idle{false}**, Log. !ok → **Idle{false}**, EmitError; qq → **Exiting{None}**, ArmExitBypass, Exit (no window to protect) | PreventExit, qq:true, Log | Log(unexpected) |
| **Exiting{a, gen}** | Log(exiting) | Log(stale) | Log(stale) | Log(exiting) | Log | Log | Log | Log | Log(exiting) | Log(stale) | bypass==Some(gen) → clear, AllowExit. else PreventExit, Log(unarmed exit request while exiting) | terminal: Log(exited) |

Choices that differ from today, each tied to the finding it resolves:

- **Recovering ignores FrontendReady** (review-5 B1′). The native dialog is modal and
  cannot be dismissed programmatically; two UIs for one decision is the bug. The
  dialog answers; the ready bridge is remembered for the next attempt.
- **⌘Q during a Close recovery dialog upgrades the attempt** instead of a second dialog.
- **An intent before any bridge is ready waits** (D1): a ⌘Q right after launch enters
  `AwaitingFrontend`; the grace timeout, not the first ready, decides recovery. An
  upgrade in that state re-arms the timeout (D9/1).
- **A quit queued during recreation waits in `AwaitingFrontend`** or is asked at once if
  the bridge already reported in the reserved generation (D4, D12).
- **A quit queued behind a successful close exits directly** (D2); behind a failed close
  it goes through the normal ask (D10/7).
- **Direct exit only from `hidden_by_close` or with no window** (D11). ⌘H then ⌘Q asks,
  showing the window first.
- **Timeout in Asking never clears a live bridge's readiness on its own** (review-5 F3);
  `FrontendUnready` and `EmitFailed` with a matching owner do.
- **Recreation requested while busy is queued** and started on the way back to `Idle`
  (D13).
- **`Exiting` is a state** (D10/8): once `Exit` is emitted nothing else can start, and a
  second `ExitRequested` cannot consume the bypass out of order.
- `ExitRequested` is an event of the machine: the bypass check is a transition, not an
  interpreter branch.

## 4. Invariants (property tests)

`[dev-dependencies] proptest = "<exact pin>"`. Generate sequences of 1–40 events from a
strategy that produces both valid owners (from the machine's current state) and stale
ones; run `step` and check after every event:

1. **No silent step.** `effects` is non-empty.
2. **No stale native action.** Every `Finalize(a)`, `Exit`, `ArmExitBypass` is emitted in
   a step whose event's owner matched the state's attempt, or by `Begin(Quit)` in
   `Idle{hidden_by_close}` / with no window.
3. **No lost intent.** A `Begin(Quit)` that was accepted (state left Idle, queued,
   upgraded, or entered Exiting) is followed, once the driver supplies the answering
   events (`Decide` allow, `Recovered` allow, `Finalized{ok:true}`, `FrontendReady`,
   `RecreationFinished{ok:true}`, `ExitRequested`), by exactly one `AllowExit` before
   the driver runs out. Same for Close (one `Finalized{ok:true}`) unless superseded or
   upgraded by a Quit.
4. **No stuck state.** From any reachable state there is a sequence of at most 4 answer
   events that reaches `Idle` or `Exiting`. Checked by exhaustive search after each
   generated prefix.
5. **Owners are monotone**: sequences per attempt id and recreation ids never decrease;
   a completion with a lower or unknown id is always `Log(stale)`.
6. **Bypass discipline.** `AllowExit` is emitted only in a step that consumed a bypass
   armed in the same generation; two `ExitRequested` never both get `AllowExit`.

The 27 existing unit tests are rewritten over `step` as named scenarios; each review
finding keeps its ID in the test name (review-3 NEW-1…, review-4 B1…, review-5 B1′,
Codex 1–8).

**Trace equivalence** (D14): the old coordinator and the new machine run against the
same recorded scenario traces during migration; differences are either a documented
decision above or a defect.

**Runtime tests** (D6): the effect runner is a trait with a fake in tests, driven through
the real event loop, asserting the effect→event table below (order, every error path
dispatches its event, `Recreating` never leaks). Event mapping and `ExitRequested` are
tested with `tauri::test::mock_builder()` (`tauri` `test` feature in
`[dev-dependencies]`, already in the locked graph).

**Inline diagrams** (D5): an ASCII state diagram at the top of `machine.rs` and the
loop/effect diagram at the top of `runtime.rs`, updated in the same commit as any table
change; the worker's Verify includes "diagram matches the `match`".

## 5. Runtime: one owner, one channel (D14)

```
Tauri events / commands / callbacks / threads
        │  Event (+ oneshot reply for lifecycle_ready)
        ▼
   mpsc::Sender<Envelope>  ──►  loop thread: machine.step(event) → effects
                                            for e in effects { runner.run(e) }
                                                  │
                     runner spawns timers, dialog callbacks, the rebuild thread,
                     and performs hide/destroy/exit; each completion sends an
                     Event back into the same channel (never calls step directly)
```

- `lifecycle_ready` sends `FrontendReady{instance_id}` with a oneshot; the loop answers
  it with the `ReplyToken` effect. `lifecycle_unready` and `lifecycle_decision` are
  fire-and-forget.
- `CloseRequested` → `api.prevent_close()` then `Begin(Close, exists:true)`.
  `ExitRequested` → `api.prevent_exit()` is decided by the machine: the runner maps
  `AllowExit` to "do nothing" and `PreventExit` to `api.prevent_exit()`; because the
  handler must answer synchronously, `ExitRequested` is the one event the loop processes
  through a blocking round-trip (send + wait for the `AllowExit`/`PreventExit` reply).
- `Reopen` / single-instance activation with no main handle → `RecreationStarted`; with a
  handle → show/focus, no event.

**Every effect ends in an event, on the ok path and on the error path** (D3, corrected by
Codex 9):

| Effect | Ok → event | Error → event |
|---|---|---|
| EmitRequest{a, f} | none (the bridge answers with Decide) | EmitFailed{a, f} + EmitError |
| ScheduleTimeout(a) | Timeout(a) after the delay (2 s grace in AwaitingFrontend, 5 s in Asking) | `thread::Builder::spawn` error → Timeout(a) immediately |
| ShowRecoveryDialog(a) | Recovered{a, allow} from the plugin callback | the callback API has no error path; a missing window → Recovered{a, allow:false} + EmitError |
| ShowWindow | none | EmitError only (asking proceeds) |
| Finalize(a) | Finalized{a, ok:true} | Finalized{a, ok:false} + EmitError |
| ArmExitBypass(gen) | none (state in the machine) | none |
| Exit | Exited via RunEvent::Exit | `app.exit` returns nothing; the watchdog is `Exiting` itself: nothing else can start |
| Recreate(id) | RecreationFinished{id, ok:true} | RecreationFinished{id, ok:false} from a `Drop` guard on the rebuild thread, so a panic cannot leak `Recreating` |
| ReplyToken(t) | oneshot answered | receiver gone → Log |

`lib.rs` keeps no lifecycle branching beyond the event mapping. `finalize_attempt`,
`schedule_recovery_timeout`, `show_native_recovery`'s gate, `prepare_frontend_reemit` and
the mutex disappear.

The React bridge (`useDesktopLifecycle.tsx`, `requestState.ts`) does not change: the
payloads (`attemptId`, `generation`, `requestSequence`, `instanceId`, token) are the same.

## 6. Migration plan (worker slices, order from Codex 11)

0. **Packaged spike** (macOS, throwaway branch): window rebuild from a worker thread,
   the callback dialog while a request is pending, `⌘Q` delivery while the modal is
   open, `app.exit` re-entrancy with a prevented `ExitRequested`, and whether a hidden
   window's bridge answers a request. Each answer either confirms a table cell or
   changes it before slice 1. One commit with a `docs/designs/lifecycle-spike.md` note.
1. `machine.rs` and `runtime.rs` added and compiled beside the old module (`mod
   lifecycle::{machine, runtime}` declared; nothing wired), with the ASCII diagrams, the
   27 scenarios rewritten, the Codex scenarios 1–8, and the fake-runner tests.
2. proptest suite with invariants 1–6; fix `step` until 10 000 cases pass.
3. Trace equivalence: record the scenario traces from the old coordinator's tests and run
   both implementations; document every difference as a decision above or fix it.
4. Switch the event mapping in `lib.rs` to the loop; mock-runtime tests for the mapping
   and `ExitRequested`. Old coordinator still compiled, unused.
5. Packaged smoke on macOS: ⌘Q before the bridge is ready, ⌘W then ⌘Q within the hide,
   Dock reopen then ⌘Q, ⌘H then ⌘Q with a dirty draft, dirty draft then Stay then close
   again, bridge reload during a request.
6. Delete the old coordinator and its tests. Full Verify green.

Each slice is one commit; the design review approved the table before slice 0.

## 7. Out of scope

Bridge changes, draft registry, picker/detail behaviour, geometry, sidebar, Windows/Linux
runtime verification, detached-thread cancellation on exit (N8: with every effect
completing through the channel, a thread that outlives the app only logs).

## 8. Open questions for the spike

- Q1: does `⌘Q` reach `ExitRequested` while the recovery dialog is modal? If not, the
  `upgrade_to_quit` cell is unreachable and is deleted, not kept.
- Q2 (kept): `RecreationFinished{ok:false}` with a queued Quit exits directly.
- Q3: must `hide`/`show`/`destroy` run on the main thread on macOS? If so the runner
  uses `app.run_on_main_thread` for those three effects and nothing else changes.

## 9. Review outputs (/plan-eng-review, 2026-09-17)

### NOT in scope
- React bridge and `requestState.ts`: payloads unchanged; a bridge rewrite would widen the diff without touching the defect class.
- Draft registry, picker, detail, geometry, sidebar: closed by rounds 4–5; unrelated to the coordinator.
- Windows/Linux runtime verification: source stays portable; packaged runs remain a separate slice.
- Native notifications, tray, updater: excluded by the CEO review (2026-09-16).
- Detached-thread cancellation on exit (N8): stays in CHANGELOG Known gaps (D8).
- A state-machine crate (statig, smlang, rust-fsm): none adds exhaustiveness beyond `match`, and each adds a pinned dependency and a DSL to review.

### What already exists
- 27 coordinator unit tests in `src-tauri/src/lifecycle.rs`: reused as named scenarios over `step` and as the trace corpus, not rebuilt.
- `src/lifecycle/requestState.ts`: the same pure-transition pattern on the React side, already reviewed clean; the design mirrors it.
- `finalize_attempt`, `show_native_recovery`, `schedule_recovery_timeout` in `lib.rs`: their side effects (hide/destroy/exit, callback dialog, timeout thread) move verbatim into the runner; only the branching moves into the machine.
- Tauri `test` feature with `mock_runtime`: already in the locked graph.
- `exit_bypass` one-shot: kept, now armed by an effect and consumed by a transition.

### Failure modes
| Codepath | Realistic failure | Test | Handling | User sees |
|---|---|---|---|---|
| `step` cell | wrong transition loses an intent | proptest inv. 3 + scenarios | pure | n/a |
| loop thread | effect completion sent while the loop is busy | channel ordering test | serialised by design | nothing |
| `EmitRequest` | emit fails (window gone) | fake runner | EmitFailed → readiness cleared only if owner matches | timeout → recovery dialog |
| `ShowRecoveryDialog` | window missing | fake runner | Recovered{allow:false} + EmitError | notice, close cancelled |
| `Finalize` | hide/destroy error | fake runner | Finalized{ok:false} + EmitError; queued quit re-asked | notice |
| rebuild thread | panic before finish | Drop guard test | RecreationFinished{ok:false} | error notice; queued ⌘Q exits |
| `ExitRequested` | second request while Exiting | scenario + mock runtime | PreventExit, Log | nothing (process exits) |
| `lifecycle_ready` | oneshot receiver dropped | fake runner | Log | nothing |
| timeout thread | spawn fails | fake runner | immediate Timeout | recovery dialog |
No critical gaps: every row has a test and handling.

### Worktree parallelization
Sequential implementation, no parallelization opportunity: slices 0–6 all touch `src-tauri/src/` and each depends on the previous.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T0 (P1, human: ~1 day / CC: ~30min)** — spike — Packaged macOS spike answering Q1–Q3 and the hidden-bridge question (Codex 9/11, D14)
  - Surfaced by: Outside voice — findings 9 and 11
  - Files: throwaway branch; `docs/designs/lifecycle-spike.md`
  - Verify: each question answered with an observed result
- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — machine.rs — `AwaitingFrontend` with grace timeout; upgrade re-arms it (D1, D9/1)
  - Files: src-tauri/src/lifecycle/machine.rs
  - Verify: scenarios `b1prime_quit_before_bridge_ready_waits_then_asks`, `codex1_upgrade_in_waiting_rearms_timeout`
- [ ] **T2 (P1, human: ~1h / CC: ~5min)** — machine.rs — `Idle{hidden_by_close}`; direct exit only from it or with no window; queued quit after a successful close exits, after a failed close is asked (D2, D11, D10/7)
  - Verify: scenarios `new1_quit_queued_behind_close_exits_after_hide`, `codex2_cmd_h_then_quit_asks`, `codex7_failed_close_reasks_queued_quit`
- [ ] **T3 (P1, human: ~1 day / CC: ~20min)** — runtime.rs — Single-owner event loop, oneshot reply for `lifecycle_ready`, blocking round-trip for `ExitRequested`, effect→event table with `Drop` guard and `thread::Builder` (D3, D14, Codex 9)
  - Files: src-tauri/src/lifecycle/runtime.rs, src-tauri/src/lib.rs
  - Verify: fake-runner tests, one per row of the §5 table
- [ ] **T4 (P1, human: ~2h / CC: ~10min)** — machine.rs — `Recreating{id, reserved, ready}`: readiness before completion is minted in the reserved generation (D12, Codex 3); queued quit → Asking/AwaitingFrontend (D4)
  - Verify: scenarios `codex3_ready_before_recreation_finished_is_kept`, `s2_quit_queued_during_recreation_is_asked_by_new_bridge`
- [ ] **T5 (P1, human: ~1h / CC: ~5min)** — machine.rs — `recreate_pending` in Asking/Recovering/Finalizing/AwaitingFrontend, composed on return to Idle (D13, Codex 4)
  - Verify: scenario `codex4_recreation_requested_while_asking_starts_after_cancel`
- [ ] **T6 (P1, human: ~2h / CC: ~10min)** — machine.rs — `Exiting` state, `ArmExitBypass`/`Exit`/`AllowExit`/`PreventExit` effects, `ExitRequested`/`Exited` events (D9/5, D10/8)
  - Verify: scenarios `codex5_finalize_quit_arms_bypass_first`, `codex8_second_exit_request_while_exiting_is_prevented`; invariant 6
- [ ] **T7 (P1, human: ~1h / CC: ~5min)** — machine.rs — `EmitRequest{attempt, frontend}` / `EmitFailed` with owner check (D9/6)
  - Verify: scenario `codex6_late_emit_failure_does_not_clear_replacement_bridge`
- [ ] **T8 (P1, human: ~1 day / CC: ~30min)** — machine.rs — 27 scenarios rewritten over `step` (regression rule); proptest invariants 1–6 with ids and completion-based counting (D10/10)
  - Verify: `cargo test`, 10 000 cases
- [ ] **T9 (P1, human: ~half day / CC: ~15min)** — tests — Trace equivalence old vs new; mock-runtime tests for event mapping and `ExitRequested` (D6, Codex 11)
  - Files: src-tauri/src/lifecycle/, src-tauri/Cargo.toml (dev-dependencies: tauri `test`, proptest exact pin)
- [ ] **T10 (P2, human: ~1h / CC: ~5min)** — machine.rs, runtime.rs — ASCII state and loop diagrams in file headers (D5)
_No new tasks from Performance review._

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 (2026-09-16, Tauri plan) | clean, stale for this design | 5 proposals, 5 accepted, 0 deferred |
| Outside Review | codex-lean `codex exec` (gpt-5.6-sol), provider codex, host claude | Independent 2nd opinion | 3 (2 skipped on the Tauri plan, 1 completed here) | completed | 11 findings: 7 blockers, 4 should-fix; all folded via D9–D14 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 (2026-09-16 Tauri plan; 2026-09-17 this design) | clean | 17 issues (6 native + 11 outside), 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (no UI change in this design) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, phase plan-review, completed, model gpt-5.6-sol (verified in the lean session log); 11 findings, each decided individually (D9, D10 multi-select; D11–D14 single). Earlier Tauri-plan phases: outside skipped by user choice (D14/E4 on 2026-09-16).
- **CROSS-MODEL:** native review (Claude, 6 findings) and Codex (11 findings) overlapped on none by ID but agreed on the class (silent gates, effect completion); Codex found 6 table defects the native pass missed (upgrade timeout, hidden-window quit, early readiness, refused recreation, bypass ordering, emit owner) and one native assumption that was fiction (dialog error path). The user accepted all Codex recommendations; no tension was resolved against the outside voice.
- **VERDICT:** ENG CLEARED — ready to implement from slice 0 (packaged spike). CEO review predates this design and covered the Tauri slice, not the coordinator redesign; not required.

NO UNRESOLVED DECISIONS
