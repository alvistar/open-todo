# Fifth-pass delta review: Tauri desktop shell

Independent read-only review (Opus, medium) of `87158e3..1f1228d`, the round-5 fixes for review-4. Guiding question: did any fix move a defect instead of removing it? Coordinator verified B1' in `src-tauri/src/lifecycle.rs` (`begin` stores `active_frontend = None` on the Recover branch; `frontend_ready` then always reemits; `start_recovery` refuses while `recovery_attempt` is set) before recording this.

## VERDICT: NOT READY for a local commit

One fix moved its defect again. B1's `TimeoutOutcome::Reemit` removed the orphaned-attempt lock in the *timeout* path but created a new one in the *recovery-dialog* path, and the new one is worse: it kills Quit as well as Close.

---

## Blocker

**B1′ — A reemit silently supersedes a live native recovery dialog, and the recovery gate then refuses to reopen.**
`src-tauri/src/lifecycle.rs:165-180` (`frontend_ready`), `:185-201` (`prepare_frontend_reemit`), `:347-354` (`start_recovery`), `src-tauri/src/lib.rs:52-61`, `:284-296`, `:264-274`.

`begin()` sets `active_frontend = self.frontend_instance.clone()` (`lifecycle.rs:296`), so on the `Recover` branch `active_frontend` is **None**. `frontend_ready` treats `None != Some(token)` as "frontend changed" and produces a reemit (`:171-178`). Nothing in the reemit path consults `recovery_attempt`, and `recover()` (`:356-371`) matches on full attempt equality including `request_sequence` — so the dialog that is already on screen becomes inert. `show_native_recovery` then refuses to open a replacement because `recovery_attempt.is_some()` (`:349`) and returns silently (`lib.rs:294-296`). Exactly the boolean-gate-with-an-unhandled-outcome shape round 4 was supposed to end.

Sequence (deterministic, no sub-millisecond window):

1. App launches; the webview is still loading. User presses ⌘Q (or ⌘W) with unsaved work.
2. `begin(Quit, true)` → `frontend_instance` is None → `Recover(A seq0)`; `active_frontend = None`.
3. `show_native_recovery` → `start_recovery` sets `recovery_attempt = Some(A.id)`; dialog "The editor did not respond" appears.
4. The bridge mounts and calls `lifecycle_ready` → `frontend_ready` returns `reemit = A seq1` → `prepare_frontend_reemit` sets `active = A seq1`, `active_frontend = T` → `send_lifecycle_request` emits and schedules a fresh 5 s timeout. The in-app guard now renders **on top of the still-open native dialog**.
5. User clicks "Exit anyway" on the native dialog. `recover(A seq0, true)` → `active` is `A seq1` → `None`. Nothing happens, no diagnostic.
6. 5 s later the reemit timeout fires: `active == A seq1`, `active_frontend == frontend_instance` → not changed → `frontend_instance = None`, `TimeoutOutcome::Expired` → `show_native_recovery(A seq1)` → `start_recovery` false (`recovery_attempt` still `Some`) → **silent return**.
7. `active = Some(A seq1)` forever. Every later ⌘W → `begin` → `Ignore` (`:280`). Every later ⌘Q → `Ignore` too, because the supersede branch (`:272`) only covers *active Close + new Quit*; an orphaned **Quit** has no escape. Review-4's B1 still left ⌘Q working; this one leaves force-quit.

Second, fully deterministic entry into the same state, via the S2 fix: `finish_recreation(true)` → `new_window()` clears `frontend_instance`, then `request_lifecycle(pending Quit)` (`lib.rs:466-468`) runs against a window whose bridge cannot possibly be ready → `Recover` → step 3 above.

Test coverage: none. `b1_timeout_reemits_…` and `b1_frontend_ready_reports_…` (`lifecycle.rs:417-454`) assert only the enum value; neither exercises `start_recovery`/`recover` alongside a reemit. `recovery_dialog_is_one_per_active_attempt` (`:581-591`) still asserts the gate that now swallows the second dialog.

Fix shape: a reemit must cancel the pending recovery (`recovery_attempt = None`) in `prepare_frontend_reemit` and in `timeout_expired`'s Reemit arm, and `start_recovery` must key on the attempt's `request_sequence` so a superseded dialog cannot block a new one. `show_native_recovery`'s `if !should_show { return; }` needs a diagnostic in any case.

---

## Should-fix

**F2 — The S2 replay is guaranteed to land on an unready frontend.** `lib.rs:449-451`, `:466-468`. The queued Quit is replayed immediately after `new_window()`, which nulls `frontend_instance` (`lifecycle.rs:129`). `begin` therefore returns `Recover` and the user gets "The editor did not respond" for a window that opened 20 ms ago — plus the blocker above. The replay should wait for `lifecycle_ready` on the new generation (queue it as `pending_kind` past the generation bump), or `begin` should distinguish "no frontend yet" from "frontend gone".

**F3 — The 5 s timeout clears readiness for a live frontend, with no way back.** `lifecycle.rs:247`. The unchanged-frontend arm nulls `frontend_instance` while the in-app guard is on screen waiting for a human. The bridge only calls `lifecycle_ready` on mount, so readiness never returns; after a Cancel, the next ⌘W goes straight to `Recover` on a perfectly healthy frontend. Pre-existing, but it is the precondition for step 6 of the blocker and is now cheap to hit because rechecks also schedule timeouts (`lib.rs:92-95` → `send_lifecycle_request`).

**F4 — Dismiss clears something other than what it shows.** `src/lifecycle/useDesktopLifecycle.tsx:62-70`. `error` prefers `nativeError ?? responseError ?? summary.errors[0]`, but `onDismiss` is wired whenever `summary.errors.length > 0`. With a native error present, the button next to the native text clears the *draft* errors and the message stays on screen — the button reads as broken. Gate `onDismiss` on the displayed error actually being the draft one, and clear `nativeError` too.

**F5 — The B1/S1/S2 reproduction never ran red behaviourally.** `git show 8f6f696` adds 82 lines of tests only; they reference `TimeoutOutcome`, `FrontendReadyOutcome` and the `RecreationOutcome` struct, none of which exist at `87158e3`. That commit does not compile, so "red" is a build failure and every other coordinator test is red with it. S3/S4/S5's repro commits (`043e411`, `299e3c3`) are genuine — they fail on behaviour.

---

## Nits

- `requestState.ts:66` — when a settle arrives after a recheck has replaced `current`, `responseError` is set to `null`, discarding a real invoke failure.
- `lifecycle.rs:269` — `begin(Close)` during recreation is still a bare `Ignore`; narrow (no window exists) but it is the same silent-return shape the plan bans.
- `lib.rs:434-477` — if the recreate thread dies before `finish_recreation`, `recreation_in_progress` stays set and a `pending_kind` Quit is never replayed.
- `lib.rs:380-384` — a poisoned mutex makes `finish_finalize` unreachable, leaving `finalizing` set for the process lifetime.
- `PickerField.tsx:51-61` — `mountedRef` is now only written, never read; the S5 fix removed its last use.
- `TaskDetail.test.tsx:520,588` — the global draft registry is cleaned by hand in each test instead of an `afterEach`; a new failing assertion before the cleanup line leaks an error entry into the next test.

---

## Changed assertions: invariants preserved?

- `finalization_reservation_is_taken_before_a_newer_request_can_start` (`:668-687`) — was `Ignore`, now `Queued(Quit)`. Still proves no new attempt starts; strictly stronger (the quit is no longer lost). OK.
- `new_4_timeout_cannot_clear_a_replacement_frontend` (`:757-775`) — extended, not weakened: still asserts readiness survives, plus the Reemit. OK.
- `finish_recreation`/`recover` signature changes — `recover` still keys on full attempt equality (stale dialog answers rejected); `finish_recreation` takes `pending_kind` *before* `new_window()` clears it (`:157-158`), so the queued quit is not lost. OK.
- `decide` taking the reservation under one lock (`:341`) genuinely closes S1 on both the decision and the recovery path; `authorize_finalize` is gone from the tree.

---

## Interleavings checked and excluded

- Double finalize from reemit + a late decision: `decide` compares `request_sequence`, so the old frontend's answer is `Stale`; `recover` compares the whole attempt. One winner only.
- `frontend_ready` reemit racing its own attempt's timeout (lock released between `lib.rs:50` and `:56`): either order ends with one emit — `prepare_frontend_reemit`'s `active.request_sequence >= attempt.request_sequence` rejects the loser.
- Two concurrent `frontend_ready` calls: the second `prepare` is rejected by the same `>=` guard.
- Queued quit replayed after a cancel or a new generation: `pending_kind` is only set while `finalizing` or `recreation_in_progress`, and no cancellable attempt can coexist with either.
- `timeout_expired`'s `(None, Some(_))` arm reaching a Recover attempt: after a reemit `active_frontend` is always `Some`, so the arm stays unreachable.
- S3 payload field names: `LifecycleAttempt` serializes `requestSequence` (serde camelCase) and `LifecycleDecisionPayload` deserializes it; the TS interfaces match on both directions.
- S3 in-flight guard and settle guard now key on `requestSequence`, so a recheck is answerable and the origin's settle no longer clears it; `responseId` ordering keeps the stale settle inert.
- S5 release accounting: `release` is idempotent (`released` flag), the retry releases the prior entry via `pendingReleaseRef` before registering a new one, and each `PickerField` owns its own ref — no cross-entry clearing, no double registration.
- Unmount during a picker error: the entry is intentionally retained and is reachable only via `clearDraftErrors`, which is now wired.