# Slice-1 review: lifecycle machine and runtime vs design

Independent read-only review (Opus, medium) of `alvistar/trevally..a0dfb21` on branch `alvistar/lifecycle-machine`, cell by cell against `lifecycle-state-machine.md` §3. The coordinator amended the design after S4 (ShowWindow on every ask from Idle; ArmExitBypass listed in the Recovered(allow, Close) cell) in the same commit as this report.

## Verdict

**NOT READY** to merge as slice 1 — one transition-table cell diverges from §3 and a test pins the divergence; the plan's test-documentation requirement is unmet; one runtime test asserts nothing.

---

## Findings

### Blocker

**B1 — `Asking × Timeout` omits `EmitError`.**
`src-tauri/src/lifecycle/machine.rs:642-679`. Design §3, row **Asking**, column **Timeout**: "==a: `frontend`==Some(f) → **Recovering{a,false,rp}**, EmitError, ShowRecoveryDialog; … None → **Recovering{a,false,rp}**, ShowRecoveryDialog". The code collapses the `Some(f)` and `None` cases into one `_ =>` arm emitting only `ShowRecoveryDialog(attempt)`. The bridge is therefore never told the request timed out while it is still the recorded frontend, which is exactly the "notice" path §9's failure-mode table promises.
Pinned by a test: `old_new_4_timeout_cannot_clear_a_replacement_frontend` (`machine.rs:2531-2571`) asserts `vec![Effect::ShowRecoveryDialog(..)]` with `self.frontend == Some(f)`. `old_timeout_without_frontend_opens_recovery_dialog` (`:1806`) is the legitimate `None` case and stays correct.

### Should-fix

**S1 — `recreate_pending` is dropped when a quit is queued behind a failed finalization.**
`machine.rs:905-928`. Design **Finalizing × Finalized{ok:false}**: "qq → compose `Begin(Quit, exists)` through the normal path (D10/7); rp composition" — both continuations. Code is `if queued_quit { … } else if recreate_pending { … }`, so a recreation queued during a failed close is lost permanently (the machine lands in `Asking{recreate_pending:false}` and no `Recreate` is ever emitted). Counterexample: `Begin(Close)`→`Decide(Allow)`→`RecreationStarted`→`Begin(Quit)`→`Finalized{ok:false}` — no `Recreate` effect anywhere in the trace. No test covers it. (The same drop on the `ok:true` path is harmless: that branch always reaches `Exiting`.)

**S2 — `a_gone_loop_prevents_exit` does not exercise the gone loop.**
`runtime.rs:262-268`. It clones the handle, drops the original, and calls `exit_requested()` on the clone — the loop thread is still running and the channel is open, so the `Prevent` comes from the machine's `Idle × ExitRequested` (no bypass), not from the `send().is_err()` branch at `runtime.rs:71`. Plan's loop contract item "`exit_requested()` returns Prevent if the loop is gone" is therefore **unverified**.

**S3 — No test doc comment cites a decision, as the plan requires.**
Plan, Seams under test: "Where an old test asserts behaviour the design changed, the new test asserts the design's behaviour and its doc comment cites the decision (D2, D11, Q1, …)". There are **zero** `///` comments in the test module; only three inline `//` citations exist (`machine.rs:2089` D9/6, `:2274` D12, `:2682` Q1). Tests whose assertion changed silently versus the old coordinator and carry no citation: `old_new_3_recreation_refuses_an_active_lifecycle_attempt` (`:2497`, now *queues* per D13 — the name still says "refuses"), `old_new_4_timeout_cannot_clear_a_replacement_frontend` (`:2531`, now goes to the dialog), `old_s2_quit_during_recreation_is_replayed_after_failure_too` (`:2187`), `old_new_1_quit_during_close_finalization_is_not_lost` (`:2422`), `old_quit_without_a_visible_window_can_exit_directly` (`:1640`).

**S4 — `ShowWindow` and `Idle{hidden_by_close:true}` have no test.**
`Effect::ShowWindow` appears only at `machine.rs:319`; no test constructs it. No test reaches `Idle{hidden_by_close:true} × Begin(Close|Quit)` with a live frontend, so the D11 ask-a-hidden-window path is entirely uncovered. `codex2_cmd_h_then_quit_asks` (`:1704`) does *not* model ⌘H — it starts from `Idle{hbc:false}` with a visible window, so it only re-tests the ordinary ask. (Separately: the design's D11 prose "⌘H then ⌘Q asks, showing the window first" is unimplementable as written, since a user ⌘H never sets `hidden_by_close`; the code follows the §3 table, which is the right call, but the prose/table conflict should be recorded rather than left silent.)

### Nit

- `machine.rs:818-847` `authorize_recovered` is byte-identical to `authorize` (`:1218`); and both add `ArmExitBypass` before `Finalize` on non-macOS, which §3's **Recovering × Recovered(allow, Close)** cell does not list (only the **Asking × Decide** cell carries the "(ArmExitBypass on non-macOS)" parenthetical). Untested under `cfg`.
- `machine.rs:2571` `let _ = token;` — dead binding left after the assertion changed.
- Two tests carry the `old_` prefix with no counterpart in the old coordinator: `old_timeout_without_frontend_opens_recovery_dialog`, `old_recovery_dialog_authorizes_one_attempt`. The 26 real old tests are all present and correctly named.
- `Log` payload drift: `Idle/AwaitingFrontend/Asking/Finalizing × Exited` return `Log("stale")` where §3 says `Log(unexpected)`; `Exiting`'s catch-all returns `Log("exiting")` where §3 says `Log(stale)` for `Decide`/`Finalized`/`RecreationFinished`. Behaviourally equivalent, but §3 uses these strings as the reason channel.
- `machine.rs:1009-1023` `Recreating × FrontendUnready` also clears `self.frontend` when the token matches the *outgoing* generation's frontend; §3 says "clear ready if equal". Harmless (overwritten at `RecreationFinished{ok:true}`).
- `runtime.rs:113,117` uses `log::debug!`; the plan says runtime.rs is "std only". `log` is already a crate dependency, so this is cosmetic.
- ASCII diagram (`machine.rs:1-20`): missing the `Idle ──Begin(frontend known)──► Asking` edge (the common path) and the `Finalizing ──Finalized(ok:false)──► Idle` edge; `ShowWindow` and the `Idle ──ExitRequested──►` cell are absent. State names and existing arrows match §3. `runtime.rs:1-12` diagram matches §5.

---

## Table rows (§3)

- **Idle{hbc}** — all cells match.
- **AwaitingFrontend{a, rp}** — all cells match.
- **Asking{a, f, rp}** — differs: **Timeout** (B1, missing `EmitError` in the `frontend==Some(f)` case). All other cells match.
- **Recovering{a, rp}** — all cells match (non-macOS `ArmExitBypass` nit aside).
- **Finalizing{a, qq, rp}** — differs: **Finalized{ok:false}** drops `recreate_pending` when `qq` (S1). All other cells match.
- **Recreating{id, res, qq, ready}** — all cells match.
- **Exiting{a, gen}** — all cells match.

Rules §2/§4 verified by inspection: no arm returns an empty vector (every `match` arm is a literal non-empty `vec!`, plus `debug_assert!` at `machine.rs:192`); staleness is full-tuple only (`same_attempt` at `:1267`, `owner_matches` at `:1271`, `RecreationId` equality at `:1044`); tokens are minted only by the machine, in `reserved` while `Recreating` (`:1001`); direct exit (`ArmExitBypass`+`Exit` with no prior authorization) occurs only in `Idle × Begin(Quit)` under `hbc` or `!window_exists` (`:236-254`) and in `Recreating × RecreationFinished{ok:false, qq}` (`:1120`, explicitly allowed by §8 Q2); `ExitRequested` consumes the bypass only at `self.generation` (`:290`) or the `Exiting` generation (`:1143`); `Exiting` accepts only `ExitRequested`/`Exited`, everything else logs.

Runtime loop contract: effects run after `step` returns, in order (`runtime.rs:92-111`) — covered by `effects_are_observed_in_step_order`; re-entrancy impossible, a runner's `tx.send` queues behind the current envelope — covered by `event_sent_during_run_waits_until_current_effects_finish`; replies answered before, and effects still forwarded to, the runner (`:95-110`) — `AllowExit` forwarding covered, `ReplyToken` forwarding not asserted by any test; missing answer → `Prevent` / dropped token sender + log (`:113-121`) — no test (the Exit branch is unreachable given the table; the Token branch is exercised only for a dropped receiver by `dropped_reply_does_not_panic_the_loop`); `exit_requested()` → Prevent when the loop is gone — **not covered** (S2); no sleeping, no time in `runtime.rs` (`std::time` appears only in the test module's `recv_timeout`).

Standards: `machine.rs` imports nothing but `std::mem::replace` — no tauri, thread or time. `src-tauri/src/lib.rs` and `src-tauri/Cargo.toml` are untouched by the diff. `#[allow(dead_code)] // wired in slice 4` sits at module-declaration level in `mod.rs:1-4`, and `mod.rs` is otherwise byte-identical to the old `lifecycle.rs` (verified by `diff`).

## Interface deviations

None. `Kind`, `Decision`, `Attempt`, `Token`, `RecreationId`, `State`, `Event`, `Effect`, `Machine::{new,state,generation,step}`, `Envelope`, `Reply`, `ExitVerdict`, `EffectRunner::run`, `LifecycleHandle::{send,ready,exit_requested}` and `spawn_loop` match the plan's Interfaces section exactly — names, derives, `pub` fields, and return types.