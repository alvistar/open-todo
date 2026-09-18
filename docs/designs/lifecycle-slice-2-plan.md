# Slice 2: property tests for the lifecycle machine

Parent design: `docs/designs/lifecycle-state-machine.md` (§2 rules, §3 table, §4 invariants,
§8 spike answers). Base: `3a3becc` on `alvistar/trevally`. Branch: `alvistar/lifecycle-props`.
Runs in parallel with slices 3 and 4: **touch only the files listed here**.

REASONING: max

## Files and symbols in scope

- `src-tauri/src/lifecycle/properties.rs` (declared, empty, `#[cfg(test)]`): the proptest
  strategies, the driver, and one `proptest!` test per invariant.
- `src-tauri/src/lifecycle/machine.rs`: **only** `Machine::step` and its private helpers, and
  only when an invariant proves a cell wrong. Every change to a cell is listed in the report
  with the invariant and the shrunk counterexample that forced it. Existing scenario tests in
  `machine.rs` may be updated only to follow such a cell change (list them too).
- `Cargo.toml`/`Cargo.lock`: already carry `proptest = "=1.11.0"`; do not edit.

## Interfaces

No new public API. Inside `properties.rs`:

```rust
use super::machine::*;
use proptest::prelude::*;

/// A generated event is either valid for the machine's current state (owner tuples taken
/// from `machine.state()`, ids from the reachable attempt/recreation ids) or deliberately
/// stale (wrong id, generation, or sequence). Both must be produced with real frequency.
fn arb_event(machine: &Machine) -> BoxedStrategy<Event>;

/// Applies `events` in order; returns the full trace `(Event, State-after, Vec<Effect>)`.
fn run(machine: &mut Machine, events: Vec<Event>) -> Vec<(Event, State, Vec<Effect>)>;

/// Invariant 3/4 driver: from the current state, feeds only *answer* events
/// (Decide allow with matching owner, Recovered allow, Finalized{ok:true}, FrontendReady,
/// RecreationFinished{ok:true}, ExitRequested, Exited) until Idle or Exiting, at most `max`
/// steps; returns the trace or None if not reached.
fn drive_to_rest(machine: &mut Machine, max: usize) -> Option<Vec<(Event, State, Vec<Effect>)>>;
```

Sequence generation is state-dependent, so build sequences step by step (generate an event,
apply it, generate the next from the new state); proptest's `prop_flat_map` or a manual
`Strategy` over `Vec<u8>` seeds decoded against the live state are both acceptable. Length
1–40. Configure `ProptestConfig { cases: 10_000, .. }` via the `PROPTEST_CASES` env var
default in the module so `cargo test` runs 10 000 cases.

## Invariants (one `proptest!` each, named `inv1_…` to `inv6_…`; quote §4)

1. **No silent step.** Every `step` returns a non-empty effect list.
2. **No stale native action.** `Finalize(a)`, `Exit`, `ArmExitBypass` appear only in a step
   whose event's owner matched the state's attempt, or in `Idle × Begin(Quit)` with
   `hidden_by_close` or `window_exists == false`, or in `Recreating × RecreationFinished{ok:false}`
   with a queued quit (§8 Q2).
3. **No lost intent.** After any generated prefix, an accepted `Begin(Quit)` (state left Idle,
   queued, or entered Exiting) is followed under `drive_to_rest` by exactly one `AllowExit`;
   an accepted `Begin(Close)` by exactly one `Finalized{ok:true}`-consuming step unless a Quit
   superseded it.
4. **No stuck state.** After any generated prefix, `drive_to_rest(machine, 4)` is `Some`.
5. **Owners are monotone.** Per attempt id the sequence never decreases across the trace;
   recreation ids never decrease; a completion with a lower or unknown id yields exactly
   `[Log(..)]`.
6. **Bypass discipline.** `AllowExit` appears only in a step whose state carried a bypass armed
   for the current generation, and never twice without an `ArmExitBypass` in between.

## Seams under test

`Machine::step` through `Event`/`State`/`Effect` only. Internals (private fields) are never
read; the driver infers owners from `machine.state()`. NOT tested here: `runtime.rs`,
`lib.rs`, the old coordinator, timing.

## Verify (from the worktree root)

```bash
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" PROPTEST_CASES=10000 cargo test --manifest-path src-tauri/Cargo.toml -- lifecycle::properties
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix.

## Out of scope

`runtime.rs`, `traces.rs`, `tauri_runner.rs`, `lib.rs`, `lifecycle/mod.rs`, `Cargo.toml`, docs.
The design's table is the spec: if an invariant and a cell disagree, ask before changing the
cell; the answer may be "the invariant's strategy is wrong".

## Slices for the TDD loop (one commit each)

1. `arb_event` + `run` + inv1 (red on an empty stub is not a reproduction: write inv1 against
   the real `step` and expect green; the red test of this slice is inv2 or later if any fails).
2. inv2, inv5, inv6.
3. `drive_to_rest` + inv3, inv4.
4. 10 000 cases; any counterexample → shrunk trace in the report → cell fix (ask first if the
   cell is in the design) → re-run.
