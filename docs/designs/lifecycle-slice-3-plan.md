# Slice 3: trace equivalence between the old coordinator and the machine

Parent design: `docs/designs/lifecycle-state-machine.md` (§3 table and "choices that differ
from today"). Base: `3a3becc` on `alvistar/trevally`. Branch: `alvistar/lifecycle-traces`.
Runs in parallel with slices 2 and 4: **touch only the files listed here**. This slice is
**report-only**: it never edits `machine.rs`; differences go into the report and the
coordinator decides.

REASONING: high

## Files and symbols in scope

- `src-tauri/src/lifecycle/traces.rs` (declared, empty, `#[cfg(test)]`): the trace harness and
  one test per old scenario.
- `docs/designs/lifecycle-traces.md` (new): the deliverable, one row per old scenario.

## Interfaces

```rust
use super::{LifecycleCoordinator, LifecycleKind, LifecycleDecision, LifecycleDecisionPayload,
            BeginResult, DecisionResult, TimeoutOutcome, FrontendReadyOutcome, RecreationOutcome};
use super::machine::{self, Machine, Event, Effect, State};

/// One call on the old coordinator, in the vocabulary of `lifecycle/mod.rs`.
enum OldCall {
    NewWindow, BeginRecreation, FinishRecreation(bool), FrontendReady(String),
    PrepareFrontendReemit(super::LifecycleAttempt), FrontendUnready(super::FrontendToken),
    FrontendLost, FinishFinalize(super::LifecycleAttempt), TimeoutExpired(super::LifecycleAttempt),
    Begin(LifecycleKind, bool), Decide(LifecycleDecisionPayload),
    StartRecovery(super::LifecycleAttempt), Recover(super::LifecycleAttempt, bool),
    ArmExitBypass(u64), TakeExitBypass(u64),
}

/// Outcome class of an old call, coarse enough to compare across the two implementations.
#[derive(Debug, PartialEq, Eq)]
enum Outcome { Asked, Recovered, AllowedDirect, Ignored, Queued, Authorized, Cancelled, Stale,
               Recheck, Expired, Reemit, Bypassed, NoOp, Other(&'static str) }

/// Maps one old call to the machine events it corresponds to (0..n) and the outcome class
/// the *design* expects; returns None when the old call has no counterpart (list it).
fn map_call(call: &OldCall, machine: &Machine) -> Option<(Vec<Event>, Outcome)>;

/// Classifies the old coordinator's return value.
fn classify_old(result: OldResult) -> Outcome;
/// Classifies a machine step from its state-after and effects.
fn classify_new(state: &State, effects: &[Effect]) -> Outcome;

/// Runs a trace on both and returns the rows: (call, old outcome, new outcome, same?).
fn compare(trace: &[OldCall]) -> Vec<Row>;
```

`OldResult` is a small enum wrapping each old method's return type; `Row` carries the call,
both outcomes and a `same: bool`. Keep the mapping table explicit and readable: it is the
document a reviewer checks.

## Traces

One trace per old scenario test in `lifecycle/mod.rs` (26 tests): transcribe the exact call
sequence of each test body into an `OldCall` vector (do not reinterpret it). For each trace,
a `#[test]` runs `compare` and asserts **only** that the row count matches the call count; the
`same` column is data, not an assertion, because differences are expected where the design
changed behaviour.

## Deliverable: `docs/designs/lifecycle-traces.md`

A table with one section per old test: the trace, then rows `call | old outcome | new
outcome | same | explained by`. `explained by` cites the design decision (D2, D11, D13, Q1,
review-5 F3, …) for every `same = false` row, or says **UNEXPLAINED** when no decision in the
design accounts for it. End with a summary: N rows same, M different-explained, K unexplained,
and the list of old calls with no counterpart (`PrepareFrontendReemit`, `TakeExitBypass`, …)
and why. The coordinator folds UNEXPLAINED rows after the wave; do not fix them here.

## Seams under test

The public API of both implementations only: old methods on `LifecycleCoordinator`, `step` on
`Machine`. No private field, no internals. NOT tested: `runtime.rs`, `lib.rs`, timing.

## Verify (from the worktree root)

```bash
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
grep -c '^### ' docs/designs/lifecycle-traces.md   # 26 sections + summary
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix.

## Out of scope

`machine.rs`, `runtime.rs`, `properties.rs`, `tauri_runner.rs`, `lib.rs`, `lifecycle/mod.rs`
(read-only), `Cargo.toml`, every other doc.

## Slices for the TDD loop (one commit each)

1. `OldCall`, `Outcome`, `classify_old`, `classify_new`, `map_call` with a test on one simple
   trace (`asks_ready_frontend_once`): red = the mapping returns the wrong row count.
2. The remaining 25 traces transcribed, one test each.
3. The report generated from the rows (a test may write it under `target/`; commit the
   hand-checked copy under `docs/designs/`).
