# Fourth-pass delta review: Tauri desktop shell

Independent read-only review (Opus, medium) of `02669ee..87158e3`, the round-4 fixes for review-3. Guiding question: did any fix move a defect instead of removing it? Coordinator verified B1 in `src-tauri/src/lifecycle.rs` before recording this.


**VERDICT: NOT READY for a local commit.** One fix (NEW-4) moved its defect rather than removing it: the timeout no longer kills a live frontend, but the attempt it owned is now abandoned with no recovery, and with the new `begin_recreation`/`begin` guards the window can no longer be closed at all. Two smaller relocations (NEW-3's remaining gap, quit-during-recreation) and the frontend recheck hole follow.

## Blocker

**B1 — An orphaned attempt permanently disables Close.** `src-tauri/src/lifecycle.rs:194-208` + `src-tauri/src/lib.rs:238-259`.

`timeout_expired` now returns `false` whenever `frontend_instance != active_frontend`, and `schedule_recovery_timeout` treats `false` as "nothing to do" — no error emit, no recovery dialog, and `active` is left set forever.

Sequence: (1) close A begins with frontend token T1; `active_frontend = T1`. (2) The bridge is replaced within the 5 s window — a WebView reload/HMR remount, or any `emit_lifecycle_request` failure that calls `mark_frontend_unready` (`lib.rs:232-236`, reachable from the Recheck branch at `lib.rs:78-89`) followed by a fresh `lifecycle_ready`. `frontend_instance = T2`. (3) The new bridge never learns about A — native only pushes events, and nothing re-emits on `frontend_ready` (`lifecycle.rs:143-150`). (4) A's timeout fires, sees T2 ≠ T1, returns `false`. Now `active = Some(close A)` forever: every later close hits `begin`'s `else { return Ignore }` (`lifecycle.rs:226-237`), and `begin_recreation` is refused (`:126`). Only Command-Q recovers, via the close→quit supersede branch.

Before this delta the same sequence produced a wrong-but-live outcome (readiness cleared, recovery dialog shown). The correct shape is to re-emit the request to the new token (or fail the attempt) rather than to return `false` and drop it.

Test coverage: none. `new_4_timeout_cannot_clear_a_replacement_frontend` (`lifecycle.rs:614-626`) asserts only `!timeout_expired` and `frontend_is_ready`; it never asserts that A is still resolvable, which is the invariant that broke.

## Should-fix

**S1 — NEW-3's race is narrowed, not closed.** `lib.rs:67-76` releases the coordinator lock between `decide` and `finalize_attempt`'s `authorize_finalize` (`lib.rs:328-331`). In that gap `active` is `None` and `finalizing` is `None`, so the new `active.is_some()` guard in `begin_recreation` (`lifecycle.rs:126`) does not apply: a `Reopen`/single-instance activation on the main thread with no main-window handle claims `recreation_in_progress`, and `authorize_finalize` then returns `Stale` (`:174`) — the authorized quit is discarded with only a `log::warn`. Same gap exists on the recovery-dialog path (`lib.rs:308-319`). The fix is to return the reservation from `decide` under one lock. Not covered: `new_3_recreation_refuses_an_active_lifecycle_attempt` only exercises the pre-decide state.

**S2 — A quit during recreation is dropped, and the drop is new.** `lifecycle.rs:223-225` (`if self.recreation_in_progress { return Ignore }`) was added by this delta. `ExitRequested` has already called `api.prevent_exit()` (`lib.rs:158`), so Command-Q pressed while the window is being rebuilt does nothing and is never replayed — the same class NEW-1 described, and the sibling case (quit during close finalization) got a queue while this one did not. `pending_kind` would carry it with no new state. Also escalated blast radius: if the spawned `recreate_main_window` thread dies or `try_state` is `None` (`lib.rs:439-456`), the leaked `recreation_in_progress` now blocks *every* close and quit, not just finalization. No test.

**S3 — A recheck is answerable only by Cancel, and then vanishes.** `src/lifecycle/useDesktopLifecycle.tsx:126-131` + `src/lifecycle/requestState.ts:59-67`. Native emits the recheck event before the originating `lifecycle_decision` invoke resolves. The recheck reuses the same `attemptId`/`generation`, so (a) a user click of "Discard and close"/"Exit anyway" on the recheck returns early because `inFlight` still `sameRequest`es it — only `"cancel"` is exempt; and (b) when the first invoke settles, `sameRequest(state.current, event.request)` is true against the recheck object, so `current` is set to `null` and the guard unmounts. Net: the user's second decision is swallowed, the dialog disappears, and native falls through to the 5 s native recovery dialog. Reachable whenever the draft becomes dirty/pending between the effect check and `getDraftSummary()` at `:135` (`decide` → `Recheck`, `lifecycle.rs:273-278`). The clearing half is pre-existing; the reducer rewrite was the place to fix it and did not. Covered only for Cancel (`useDesktopLifecycle.test.tsx:196-234`).

**S4 — A detached write failure is surfaced but not dismissable.** `drafts.ts:104-113`: `clearDraftErrors` has no application caller — the only reference is `TaskDetail.test.tsx:587`, behind optional chaining. A rejected detached write stays `dirty: true` with an error for the session, so the bridge renders the message permanently (`useDesktopLifecycle.tsx:62-63`) and every subsequent close shows the unsaved-changes guard. The N7 requirement was "surface and then dismissable".

**S5 — A failed write in a *mounted* picker leaves the registry clean.** `PickerField.tsx:113-116` calls `release()` in `finally` when still mounted; the rejection handler registered first (`drafts.ts:89-99`) has already rewritten the entry to `{dirty: true, error}`, and `release()` deletes it. Repro: open Priority, pick P1, server rejects, error shows in the picker, press Cmd-W → no guard, window hides with the change unsaved. The N7 test only covers the unmounted path.

## Nits

- `RequestState.received` (`requestState.ts:9`) is written by `transitionRequest` and read nowhere.
- Orig-5 threshold (`lib.rs:535-545`, and `:490`) compares physical-pixel overlap against `MIN_WIDTH/MIN_HEIGHT`, which are the *logical* min-size values in the window config; on a 2× display the guaranteed usable area is half what the comment claims. Otherwise the threshold and the test are sound.
- The replay half of the NEW-1 fix (`finish_finalize` returning `pending_kind`, `lib.rs:376-383`) has no test; `new_1_quit_during_close_finalization_is_not_lost` asserts only `!Ignore`.
- `requestState.ts` was authored inside the *reproduce* commit `1a2750d` as a model of the old behaviour, so the NEW-2 unit test never ran against the shipped hook. The component-level NEW-2 test is genuine.

## Interleavings checked and found excluded

- **(c) queued quit firing after a cancel or a new generation:** excluded. `pending_kind` is only set while `finalizing.is_some()` (`lifecycle.rs:211-222`), and `authorize_finalize` requires `active.is_none()`, so no cancellable attempt coexists with the queue; `begin_recreation` refuses while finalizing, and `new_window` clears `pending_kind` (`:119`).
- **Queued-quit leak:** excluded. `finalize_attempt` always reaches `finish_finalize` on both success and error paths, and the replay's `request_lifecycle` runs after the guard temporary is dropped — no deadlock.
- **(d) timeout clearing a dead frontend:** works. Unmount → `lifecycle_unready(T1)` → `(Some, None)` → `frontend_changed = false` → recovery fires. The `(None, Some(_))` arm is unreachable from the timeout path, since timeouts are scheduled only on `Ask`, where `frontend_instance` was `Some`.
- **Stale readiness cleanup across generations (Orig-9/N9):** token equality covers both the instance and the generation, including the StrictMode double-mount ordering where `unready(T1)` lands after `ready(T2)`.
- **(b) stale action allowed through after a *cancelled* newer attempt:** structurally possible (`authorize_finalize` passes once B's cancel has cleared `active`) but requires B to begin *and* be cancelled inside the same sub-millisecond gap as S1; treated as the same root cause, not a separate finding.
- **Orig-8:** `inert`/`aria-hidden` are applied only when `narrow && !sidebarOpen` (`Shell.tsx:62,70`), so the open sidebar is not trapped and the wide layout is untouched; the toggle lives outside `sidebarLayer` and stays reachable. Only cosmetic gap: the layer goes inert at the start of the 160 ms close transition.
- **Reproduce commits:** `1a2750d`, `0a54b0e`, `768cd65` and `c7e128d` each fail against the prior implementation (old `begin` returned `Ignore`; old `begin_recreation` returned `true`; old `timeout_expired` returned `true`; old `respondingRef` swallowed the second click; the Orig-5 repro preserves the old predicate verbatim before the fix changes it). I did not re-run `cargo test` or `pnpm test`.