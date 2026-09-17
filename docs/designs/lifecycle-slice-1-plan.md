# Slice 1: the lifecycle machine and its runtime, beside the old coordinator

Parent design: `docs/designs/lifecycle-state-machine.md` (read it in full first: §2 shape,
§3 transition table, §4 invariants, §5 runtime, §8 spike answers). Spike evidence:
`docs/designs/lifecycle-spike.md`. This slice adds the new modules and their tests and
wires **nothing**: `lib.rs` keeps using `lifecycle.rs` unchanged. Slice 2 adds proptest,
slice 3 trace equivalence, slice 4 the Tauri wiring.

REASONING: max

## Files and symbols in scope

- `src-tauri/src/lifecycle.rs` → becomes `src-tauri/src/lifecycle/mod.rs` with the old
  coordinator's contents byte-for-byte (a `git mv` plus the module declarations below).
  Its 27 tests keep running unchanged.
- `src-tauri/src/lifecycle/machine.rs` (new): `Kind`, `Attempt`, `Token`, `RecreationId`,
  `Decision`, `State`, `Machine`, `Event`, `Effect`, `Machine::step`, the ASCII state
  diagram at the top of the file, and the scenario tests.
- `src-tauri/src/lifecycle/runtime.rs` (new): `Envelope`, `EffectRunner`, `LifecycleHandle`,
  `spawn_loop`, `ExitVerdict`, the loop/effect ASCII diagram at the top of the file, the
  fake runner and its tests.
- `src-tauri/src/lib.rs`: only `mod lifecycle;` stays; add nothing else. The new modules
  are `pub mod machine; pub mod runtime;` inside `lifecycle/mod.rs`, marked
  `#[allow(dead_code)]` at module level with a comment "wired in slice 4".

## Interfaces (write exactly these; ask before changing a signature)

```rust
// machine.rs — pure, no tauri types, no threads, no time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Kind { Close, Quit }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Decision { Allow, Discard, Cancel, ExitAnyway }
#[derive(Debug, Clone, PartialEq, Eq)] pub struct Attempt { pub id: u64, pub generation: u64, pub kind: Kind, pub sequence: u64 }
#[derive(Debug, Clone, PartialEq, Eq)] pub struct Token { pub instance_id: String, pub generation: u64 }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub struct RecreationId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Idle { hidden_by_close: bool },
    AwaitingFrontend { attempt: Attempt, recreate_pending: bool },
    Asking { attempt: Attempt, frontend: Token, recreate_pending: bool },
    Recovering { attempt: Attempt, recreate_pending: bool },
    Finalizing { attempt: Attempt, queued_quit: bool, recreate_pending: bool },
    Recreating { id: RecreationId, reserved: u64, queued_quit: bool, ready: Option<Token> },
    Exiting { attempt: Option<Attempt>, generation: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Begin { kind: Kind, window_exists: bool },
    Decide { attempt_id: u64, generation: u64, sequence: u64, decision: Decision, dirty: bool, pending: bool },
    Finalized { attempt: Attempt, ok: bool },
    FrontendReady { instance_id: String },
    FrontendUnready { token: Token },
    EmitFailed { attempt: Attempt, frontend: Token },
    Timeout(Attempt),
    Recovered { attempt: Attempt, allow: bool },
    RecreationStarted,
    RecreationFinished { id: RecreationId, ok: bool },
    ExitRequested,
    Exited,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    EmitRequest { attempt: Attempt, frontend: Token },
    ScheduleTimeout(Attempt),
    ShowRecoveryDialog(Attempt),
    ShowWindow,
    Finalize(Attempt),
    ArmExitBypass(u64),
    Exit,
    AllowExit,
    PreventExit,
    Recreate(RecreationId),
    ReplyToken(Token),
    EmitError(String),
    Log(&'static str),
}

#[derive(Debug)]
pub struct Machine { /* private fields: state, generation, next_attempt, next_recreation, frontend, exit_bypass */ }
impl Machine {
    pub fn new(generation: u64) -> Self;
    pub fn state(&self) -> &State;
    pub fn generation(&self) -> u64;
    pub fn step(&mut self, event: Event) -> Vec<Effect>;   // never empty
}
```

```rust
// runtime.rs — std only (std::sync::mpsc, std::thread). No tauri types: the Tauri runner
// arrives in slice 4. The loop owns the Machine; nothing else touches it.
pub struct Envelope { pub event: Event, pub reply: Option<Reply> }
pub enum Reply { Token(std::sync::mpsc::Sender<Token>), Exit(std::sync::mpsc::Sender<ExitVerdict>) }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum ExitVerdict { Allow, Prevent }

pub trait EffectRunner: Send + 'static {
    /// Perform one effect. Completions are sent back as Events through `tx`; the runner
    /// never calls Machine::step. ReplyToken / AllowExit / PreventExit are answered by the
    /// loop itself before reaching the runner (the runner still sees them, for logging).
    fn run(&mut self, effect: Effect, tx: &std::sync::mpsc::Sender<Envelope>);
}

#[derive(Clone)]
pub struct LifecycleHandle { /* Sender<Envelope> */ }
impl LifecycleHandle {
    pub fn send(&self, event: Event);                                   // fire-and-forget
    pub fn ready(&self, instance_id: String) -> Result<Token, std::sync::mpsc::RecvError>;   // blocking round-trip
    pub fn exit_requested(&self) -> ExitVerdict;                        // blocking round-trip; Prevent if the loop is gone
}
pub fn spawn_loop(machine: Machine, runner: impl EffectRunner) -> LifecycleHandle;
```

Loop contract (runtime.rs): one thread; `recv()` an Envelope; `effects = machine.step(event)`;
for each effect in order: `ReplyToken(t)` answers the envelope's `Reply::Token` if present,
`AllowExit`/`PreventExit` answer `Reply::Exit` if present, then every effect (including
those) is passed to `runner.run`. Effects run **after** `step` returned and strictly in
order; a runner that sends an Event during `run` is queued behind the current envelope,
never processed re-entrantly. If the envelope carried a reply and the step produced no
matching answer, the loop answers `Prevent` / drops the token sender and logs.

## Seams under test

- `Machine::step` through `Event` in and `(State, Vec<Effect>)` out. Tests construct
  sequences and assert the resulting state (`machine.state()`) and the exact effect list.
  Scenario tests: rewrite each of the 27 tests in `lifecycle/mod.rs` as a test over `step`
  with the same name (prefix `old_`), then add `codex1_…` to `codex8_…` and the review
  scenarios named in the design's Implementation Tasks (T1, T2, T4–T7). Where an old test
  asserts behaviour the design changed, the new test asserts the design's behaviour and
  its doc comment cites the decision (D2, D11, Q1, …).
- The runtime loop through `spawn_loop` with a **fake runner** that records every effect
  into a shared `Vec` and can be told to send a given Event back for a given effect
  (e.g. `Finalize(a)` → `Finalized{a, ok:false}`). Tests assert: effects are observed in
  step order; an Event sent from inside `run` is processed after the current envelope's
  effects; `ready()` returns the minted token; `exit_requested()` returns Allow only after
  `ArmExitBypass` for the current generation; a dropped `Reply` does not panic the loop.
- NOT tested here: anything in `lib.rs`, Tauri, timers with real time (`ScheduleTimeout`
  is just recorded), the old coordinator's behaviour (its own tests stay as they are).

## Verify (from the worktree root)

```bash
pnpm install --frozen-lockfile
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml -- lifecycle::mod 2>/dev/null | grep -E '^test result' # old 27 still green
git diff --stat HEAD~0 -- src-tauri/src/lib.rs   # must be empty except `mod lifecycle;` unchanged
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix.

## Out of scope

- `lib.rs` beyond the module path; the React bridge; `Cargo.toml` (no proptest yet, no
  `tauri` test feature yet: slices 2 and 4); `CHANGELOG.md`, `VERSION`, `knowledge/**`,
  `docs/HANDOVER.md`.
- Deleting or changing the old coordinator's behaviour or tests (only the file move).
- Any timing: the machine is time-free; the loop never sleeps.

## Slices for the TDD loop (one commit each)

1. Move `lifecycle.rs` → `lifecycle/mod.rs`, declare the two empty modules; old tests green.
2. `machine.rs` types + `step` for `Idle`/`AwaitingFrontend`/`Asking` with their scenarios.
3. `Recovering`, `Finalizing` (+ composition with queued quit and `recreate_pending`).
4. `Recreating` (reserved generation, early ready) and `Exiting` (+ `ExitRequested`, bypass).
5. `runtime.rs` loop + fake runner tests.
6. ASCII diagrams in both file headers; a doc comment on `step` listing the composition rules.
