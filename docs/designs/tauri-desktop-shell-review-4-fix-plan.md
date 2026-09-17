# Fix plan for review-4 findings

Source report: `docs/designs/tauri-desktop-shell-review-4.md` (quote it for every
reproduction). Base commit: `87158e3` (round-4 fixes). Branch: `alvistar/trevally`.

Lesson from rounds 2–4, binding here: a fix that adds a boolean gate or an early `return false`
to the coordinator has moved the defect every time. Every event that reaches the coordinator
must end in one of: handled now, queued and replayed later, or failed with a diagnostic. An
event that silently returns is a defect.

## Findings

| ID | Location | Seam under test | Reproduction (what the red test asserts) | Cause hypothesis | Area |
|----|----------|-----------------|-------------------------------------------|------------------|------|
| B1 | `src-tauri/src/lifecycle.rs` `timeout_expired` (~194-208), `frontend_ready` (~143-150); `src-tauri/src/lib.rs` `schedule_recovery_timeout` (~238-259) | `LifecycleCoordinator` | Close A begins with ready token T1; `frontend_ready` returns T2 (replacement bridge); `timeout_expired(A)`. Today returns `false`, `active` stays `Some(A)`, and a following `begin(Close, true)` returns `Ignore`. Assert the invariant "A is still resolvable": after the sequence, either the coordinator reports A must be re-emitted to T2 (a `TimeoutOutcome::Reemit`-style result that `lib.rs` turns into a new `lifecycle:request` to the current frontend, with a fresh timeout), or A is failed and cleared so the next `begin(Close)` returns `Ask`. Second test: `frontend_ready(T2)` while A is active must itself report that A needs re-emitting, so the new bridge learns about A without waiting 5 s. | `timeout_expired` returns a bool; the "frontend changed" case has no outcome. Replace the bool with an enum {Expired, Stale, Reemit(attempt)} and handle each in `lib.rs`. | coordinator |
| S1 | `src-tauri/src/lib.rs` `lifecycle_decision` (~67-76) and `finalize_attempt` (~328-331); recovery-dialog path (~308-319) | `LifecycleCoordinator` (unit) plus a `lib.rs`-level test if the lock split can be exercised there; otherwise prove it at the coordinator by making `decide` return the finalize reservation | Between `decide(Allow)` and `authorize_finalize(A)`, `begin_recreation()` is called (activation with no main handle). Today `active` and `finalizing` are both `None` in that gap, so recreation is admitted and `authorize_finalize` returns `Stale`; the authorized quit is lost. Assert: after `decide` authorizes, `begin_recreation` is refused (or deferred) until `finish_finalize`. | The reservation is taken in a second lock acquisition. Make `decide` take the reservation atomically (return it), and drop the separate `authorize_finalize` call on that path; keep `authorize_finalize` for the recovery-dialog path only if it can be made atomic too. | coordinator |
| S2 | `src-tauri/src/lifecycle.rs` `begin` (~223-225) | `LifecycleCoordinator` | `begin_recreation()` succeeded; `begin(Quit, false)` arrives. Today returns `Ignore` and the quit is never replayed (ExitRequested already called `prevent_exit`). Assert `Queued(Quit)` and that `finish_recreation(true)` returns the pending kind for replay, mirroring the NEW-1 queue. Second test: `finish_recreation(false)` must also surface the pending quit (replay or AllowDirect), never drop it. | Same class as NEW-1: a gate without a queue. Reuse `pending_kind`. | coordinator |
| S3 | `src/lifecycle/requestState.ts` (~59-67), `src/lifecycle/useDesktopLifecycle.tsx` (~126-131) | `transitionRequest` (pure) for the state, `DesktopLifecycleBridge` (Testing Library, `invoke` under test control) for the click | Native emits a recheck with the same attemptId/generation while the first `lifecycle_decision` invoke is pending. (a) Pure: settling the first response must NOT clear `current` when the current request is the recheck object (compare by identity or by a recheck sequence, not by attempt id). (b) Bridge: the user clicks "Discard and close" on the recheck; today only Cancel is exempt from the in-flight guard and the click is swallowed. Assert a second `lifecycle_decision` invoke carries `discard`. | `sameRequest` equates a recheck with its origin; the in-flight guard exempts only Cancel. Give a request a sequence number in the native payload (or the recheck flag) and key both checks on it. If the native payload lacks a sequence, add it in `lib.rs` `request_lifecycle`. | bridge |
| S4 | `src/lifecycle/drafts.ts` `clearDraftErrors` (~104-113); `src/lifecycle/useDesktopLifecycle.tsx` (~62-63) | `getDraftSummary()` after a rejected detached write; `DesktopLifecycleBridge` for the dismissal | A detached write rejects; today the entry stays `{dirty: true, error}` for the session with no caller of `clearDraftErrors`, so every close shows the guard. Assert: the error is surfaced once (bridge or persistence notice) and a user dismissal (choose the surface: the lifecycle dialog's "Discard" or a notice close button) clears it, after which `getDraftSummary().dirty` is false. | The clear API exists but nothing calls it. Wire the dismissal in the surface that shows the error. | drafts |
| S5 | `src/ui/detail/PickerField.tsx` (~113-116); `src/lifecycle/drafts.ts` (~89-99) | `getDraftSummary()` after rendering `PickerField` with a rejecting write, picker still mounted | Open Priority, pick P1, server rejects, error visible; today `release()` in `finally` deletes the registry entry that the rejection handler had rewritten to `{dirty: true, error}`, so `getDraftSummary().dirty` is false and ⌘W would not guard. Assert `dirty` stays true while the error is shown, and clears when the user retries successfully or dismisses. | Unconditional `release()` on settle races the error rewrite. Release only on success; on failure keep the entry until retry/dismiss. | drafts |

Nits from review-4 to fold in only if touching the same lines: drop unused `RequestState.received`;
Orig-5 threshold compares physical pixels with logical MIN_WIDTH/MIN_HEIGHT (scale by the monitor
scale factor); add a test for the NEW-1 replay half (`finish_finalize` returning `pending_kind`).

## Checklist (every ID must be fixed or explicitly left out with a reason)

- [ ] B1
- [ ] S1
- [ ] S2
- [ ] S3
- [ ] S4
- [ ] S5

## Deferred (coordinator decision, do not touch)

- N8 (detached native worker shutdown) — packaged evidence needed.
- Orig-8 cosmetic: the layer goes inert at the start of the 160 ms close transition.

## Out of scope

- `VERSION`, `CHANGELOG.md`, `README.md`, `docs/HANDOVER.md`, `knowledge/**`.
- `src/model/**`, `src/api/**`, `src/queries/**`, `src/live/**` (mock at the API boundary; do not edit).
- Tauri config, capabilities, icons, `Cargo.toml` dependencies.

## Verify (from `/Users/avigano/orca/workspaces/open-todo/trevally`)

```bash
pnpm check
pnpm test
pnpm version:check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
```

The system cargo is 1.86 and fails on the locked graph; always use the PATH prefix.

## Existing tests that must stay green

All 22 tests in `src-tauri/src/lifecycle.rs`, in particular the round-4 ones (`new_1_*`, `new_3_*`,
`new_4_*`, `readiness_*`) and `finalization_reservation_blocks_newer_actions_until_finished`. All of
`src/lifecycle/*.test.ts(x)`, `src/ui/Shell.test.tsx`, `src/ui/detail/TaskDetail.test.tsx`. If B1's
enum makes `new_4_timeout_cannot_clear_a_replacement_frontend` assert too little, extend it; do
not weaken it. Ask before changing any other existing assertion.
