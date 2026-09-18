# Fix plan for the slice-1 review findings

Source report: `docs/designs/lifecycle-slice-1-review.md`. Spec: `docs/designs/lifecycle-state-machine.md`
(§3 table; note the coordinator's amendments in commit 342e4ed: `Idle × Begin` → Asking now always
emits `ShowWindow` before `EmitRequest`; `Recovering × Recovered(allow, Close)` lists
`ArmExitBypass` on non-macOS). Base: `342e4ed` on `alvistar/lifecycle-machine`.

REASONING: xhigh

| ID | Location | Seam under test | Reproduction (what the red test asserts) | Cause hypothesis | Area |
|---|---|---|---|---|---|
| B1 | `machine.rs:642-679` `Asking × Timeout` | `Machine::step` | Asking{a, f}, `frontend == Some(f)`, `Timeout(a)` → effects must be `[EmitError(..), ShowRecoveryDialog(a)]` and state Recovering. Today only `ShowRecoveryDialog`. The `frontend == None` case stays `[ShowRecoveryDialog]`. Fix the pinning test `old_new_4_timeout_cannot_clear_a_replacement_frontend` (it asserts the wrong list). | The `Some(f)` and `None` cases were collapsed into one `_ =>` arm. | machine |
| S1 | `machine.rs:905-928` `Finalizing × Finalized{ok:false}` | `Machine::step` | `Begin(Close)`→`Decide(Allow)`→`RecreationStarted`→`Begin(Quit)`→`Finalized{ok:false}`: the trace must contain a `Recreate(id)` effect (rp composition) AND the queued quit's normal Begin. Today `if queued_quit {..} else if recreate_pending {..}` drops rp. | else-if instead of both continuations. | machine |
| S4 | `machine.rs:319` `Idle × Begin` with a known frontend; `Effect::ShowWindow` | `Machine::step` | (a) `Idle{hbc:false}` + frontend known + `Begin(Quit, exists:true)` → effects `[ShowWindow, EmitRequest{..}, ScheduleTimeout(..)]` in that order (design amendment). (b) `Idle{hbc:true}` + `Begin(Close, exists:true)` → per table: Close with hbc → ask, so `[ShowWindow, EmitRequest, ScheduleTimeout]`; `Begin(Quit)` with hbc → `[ArmExitBypass, Exit]` and Exiting. Rewrite `codex2_cmd_h_then_quit_asks` so it starts from a hidden-by-⌘H situation (hbc:false, window exists, frontend known) and asserts ShowWindow precedes EmitRequest. | ShowWindow was gated on hbc, a dead condition. | machine |
| S2 | `runtime.rs:262-268` `a_gone_loop_prevents_exit` | `LifecycleHandle::exit_requested` | Make the loop actually gone: keep a handle, drop the runner-side receiver by ending the loop (e.g. drop all senders except the test's and let the loop exit when `recv` fails, or add a test-only way to stop the loop that the plan's contract allows: the loop ends when the channel is closed). Then `exit_requested()` must return `Prevent` via the `send().is_err()` branch at `runtime.rs:71`. If the loop cannot be made to exit without an API change, ask before adding one. | The test dropped a clone, not the loop. | runtime |
| S3 | `machine.rs` test module | n/a (documentation) | Every `old_*` test whose assertion differs from the old coordinator's gets a `///` doc comment naming the decision (D2, D11, D13, D10/7, Q1, …). At minimum: `old_new_3_recreation_refuses_an_active_lifecycle_attempt` (rename to `..._queues_recreation`, D13), `old_new_4_timeout_cannot_clear_a_replacement_frontend` (D1/F3), `old_s2_quit_during_recreation_is_replayed_after_failure_too` (Q2), `old_new_1_quit_during_close_finalization_is_not_lost` (D2), `old_quit_without_a_visible_window_can_exit_directly` (D11). Drop the `old_` prefix from the two tests with no old counterpart. | Plan rule skipped. | tests |
| N1 | `machine.rs:818-847` vs `:1218` | `Machine::step` | `authorize_recovered` is byte-identical to `authorize`: delete one. Existing tests must stay green. | Duplication. | machine |
| N2 | `machine.rs:2571` | n/a | Remove the dead `let _ = token;`. | leftover | tests |
| N3 | `machine.rs` `Log` strings | `Machine::step` | Align the reason strings with §3: `× Exited` in non-Exiting states → `Log("unexpected")`; `Exiting × Decide/Finalized/RecreationFinished` → `Log("stale")`. Adjust the tests that pin the strings. | drift | machine |
| N4 | `machine.rs:1-20` diagram | n/a | Add the missing edges: `Idle ──Begin(frontend known)──► Asking`, `Finalizing ──Finalized(ok:false)──► Idle`, `Idle ──ExitRequested──►`; mention ShowWindow on the Idle→Asking edge. | incomplete | docs |

Deferred (do not touch): `Recreating × FrontendUnready` also clearing `self.frontend` (harmless,
overwritten); `log::debug!` in runtime.rs (the crate is already a dependency).

## Checklist
- [ ] B1  - [ ] S1  - [ ] S4  - [ ] S2  - [ ] S3  - [ ] N1  - [ ] N2  - [ ] N3  - [ ] N4

## Out of scope
`lib.rs`, `Cargo.toml`, the old coordinator in `lifecycle/mod.rs`, the React bridge, docs other than the
two designs' code comments.

## Verify (from the worktree root)
```bash
pnpm check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
```

## Existing tests that must stay green
All 26 legacy tests in `lifecycle/mod.rs` (untouched); every machine/runtime test not named above.
Changing any other existing assertion needs a question first.
