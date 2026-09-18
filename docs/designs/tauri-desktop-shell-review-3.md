# Third-pass delta review: Tauri desktop shell

Reviewed 2026-09-17 against the uncommitted working tree. I read
`tauri-desktop-shell-review-2.md` first, then the approved requirements in
`tauri-desktop-shell.md` (D4, D5/D13, D9 and E2), and the original review for
context. This review is read-only except for this report; no implementation or
other design file was changed.

## Verification

- `pnpm test`: passed, 39 files and 680 tests; 2 files and 19 tests skipped.
- `pnpm check`: passed Biome (152 files), TypeScript and the design-token check.
- `PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml`: passed 15 native lifecycle tests.
- No `tauri build`, packaged macOS run, or Windows/Linux lifecycle run was performed.

## N1-N5 delta table

| Review-2 finding | Status | Current evidence | Proving test and limit |
| --- | --- | --- | --- |
| N1. Global Escape capture discards an active task editor | **RESOLVED** | `src/ui/overlayStack.tsx:53-74` selects one top layer during capture; `src/ui/detail/TaskDetail.tsx:123-131` declines the dialog Escape when the target is an input, textarea or contenteditable. The real app supplies the provider at `src/app/App.tsx:43-52`. | `src/ui/detail/TaskDetail.test.tsx:184-199` keeps an edited title open for Escape and still closes from a non-typing target; `src/ui/Shell.test.tsx:109-151` proves dialog/picker layers prevent sidebar dismissal. These are provider/component tests, not packaged WebView evidence. |
| N2. A stale authorized attempt can perform the native action | **RESOLVED** | `src-tauri/src/lifecycle.rs:148-164` reserves finalization only for the matching generation with no active/newer attempt, recreation or existing finalizer. `src-tauri/src/lib.rs:323-375` makes that reservation immediately before hide/destroy/exit and releases it afterward. A response that loses the reservation is discarded at `src-tauri/src/lib.rs:327-334`. | `src-tauri/src/lifecycle.rs:464-512` proves stale-after-new-request rejection and that the reservation blocks/reopens the action slot. It does not exercise a real Tauri window; NEW-1 below identifies a separate lost-intent race around the reservation. |
| N3. Command-Q with a hidden window is not a direct quit | **RESOLVED** | `src-tauri/src/lib.rs:172-212` computes `has_visible_window`; `src-tauri/src/lifecycle.rs:177-209` returns `AllowDirect` for quit without a visible main window; `src-tauri/src/lib.rs:340-350` hides on macOS and `:352-360` destroys on non-macOS. Thus a clean macOS close followed by Command-Q does not ask a hidden frontend. | `src-tauri/src/lifecycle.rs:545-552` proves the no-visible-window transition. No native test covers an actually hidden macOS handle or a Windows/Linux close event. The source has no non-macOS `hide()` path, so the proposed “hidden dirty window on Windows/Linux” scenario was not reachable in this code and is retained as a runtime verification gap, not a new finding. |
| N4. A superseded timeout can mark the current frontend unready | **PARTIALLY RESOLVED** | `src-tauri/src/lifecycle.rs:169-175` now checks the active attempt and clears readiness in one locked operation, so an old timeout cannot clear readiness after Command-Q has superseded that attempt. However, it clears whichever `frontend_instance` is current; the attempt does not carry the instance that was ready when it started. A remounted bridge can therefore become ready in the same generation and then be cleared by the old timeout (`src-tauri/src/lifecycle.rs:125-137,169-175`; `src-tauri/src/lib.rs:233-253`). | `src-tauri/src/lifecycle.rs:446-462` proves an old *attempt* timeout is stale. There is no test for a new frontend instance becoming ready before the old timeout, so the full readiness invariant remains open (NEW-4). |
| N5. A stale frontend response can clear a superseding request | **PARTIALLY RESOLVED** | `src/lifecycle/useDesktopLifecycle.tsx:121-129` now clears or reports errors only when `sameRequest` still matches the response, and `src/lifecycle/useDesktopLifecycle.tsx:25-35` correlates attempt ID and generation. The normal committed A/B case is protected. The event callback at `:65-71` updates React state without synchronously updating `requestRef`; if A resolves before B renders, A can still clear B. Also `:107-110` drops a user response when the same request is already in flight, which can drop a Cancel during a same-attempt recheck. | `src/lifecycle/useDesktopLifecycle.test.tsx:131-194` proves that an older response does not clear a newer request after B has rendered, but it resolves A only after waiting for B and cancels B afterward. It does not cover the event/render race or Cancel while the prior invoke is pending. |

## New findings introduced or exposed by the second pass

### NEW-1 — Blocker: finalization can lose a legitimate close or quit

**Locations:** `src-tauri/src/lifecycle.rs:106-123,148-158,177-180`; `src-tauri/src/lib.rs:323-375,399-446`.

The new finalization reservation correctly prevents a stale native action, but it
has no queued outcome for a legitimate event that overlaps the reservation. On
macOS, if close A has been authorized and `finalize_attempt` is executing
`hide()`, a concurrent Command-Q reaches `begin(Quit, false)` while
`finalizing` is set. `begin` returns `Ignore`; after the hide succeeds there is
no second quit event, leaving the process running in the background even though
the user explicitly chose Command-Q. The same loss can occur in the opposite
direction when a recreation starts while an active frontend guard is awaiting a
decision: `begin_recreation` does not reject an active attempt, but
`authorize_finalize` rejects it while `recreation_in_progress`; `decide` has
already cleared `active`, so the user's allowed close/quit is silently dropped
when recreation completes and advances the generation.

The existing reservation tests (`lifecycle.rs:464-512`) prove stale-action
rejection, not preservation or replay of a legitimate overlapping action. This
needs an explicit ordering policy (queue/supersede and re-emit, or prevent the
overlap) before calling the lifecycle coordinator complete.

### NEW-2 — Should-fix: the A/B request fix still has a React commit race and can drop Cancel

**Locations:** `src/lifecycle/useDesktopLifecycle.tsx:46-53,65-71,107-129`.

While invoke A is pending, native can emit request B. The listener calls
`setRequest(B)`, but `requestRef.current` remains A until React commits the
render. If A's invoke continuation runs first, `sameRequest(requestRef, A)` is
true and line 122 queues `setRequest(null)`, so B can disappear before the
frontend ever renders it; native B then waits for the timeout/recovery path.

There is a second instance of the same problem: if native re-emits the same
attempt for a recheck while its first invoke is pending, `respondingRef` still
equals that attempt and `respond` returns at `:109`. A user pressing Stay/Cancel
at that point gets no decision, and the later A continuation clears the guard.
The current A/B test only resolves A after B has rendered, so it cannot prove
these orderings. Update the ref synchronously in the event listener or use an
attempt-aware functional state transition, and allow a current Cancel to
supersede a stale in-flight response.

### NEW-3 — Should-fix: recreation can invalidate a pending lifecycle decision

**Locations:** `src-tauri/src/lifecycle.rs:106-123,148-158`; `src-tauri/src/lib.rs:399-446`.

This is the recreation branch of NEW-1 called out separately because it is
independent of the macOS hide timing. If an active close/quit request exists and
the main handle disappears, an activation can claim `recreation_in_progress`
even though `active` is still set. The frontend can then return Allow or
Discard; `decide` clears `active`, but `authorize_finalize` returns `Stale` solely
because recreation is in progress. A successful build increments the generation
and there is no request left to finish the user's action. A close/quit retry is
possible, but the first explicit decision is lost without a diagnostic.

### NEW-4 — Should-fix: an old timeout can clear a replacement frontend's readiness

**Locations:** `src-tauri/src/lifecycle.rs:125-137,169-175`; `src-tauri/src/lib.rs:233-253`; `src/lifecycle/useDesktopLifecycle.tsx:48-52,55-105`.

Attempt correlation is not frontend-instance correlation. Scenario: close A is
active in generation G, the bridge remounts (or a new WebView bridge mounts) and
calls `lifecycle_ready` with instance B, then A's five-second timeout runs. The
coordinator still sees A as active and `timeout_expired(A)` sets
`frontend_instance = None`, taking down live B and opening native recovery. The
next close treats the responsive bridge as unavailable. Add the ready-instance
token/generation to the timeout ownership check; the original mount-stable
instance issue in review-2 N9 should be fixed together with this.

### Candidate checks that did not produce an additional finding

- **Escape ignored where it should close:** no new wrong-close path was found.
  TaskDetail intentionally declines Escape while focus is in any text control,
  preserving the existing “do not discard the editor on Escape” behavior; the
  top-level dialog and picker still close from non-text targets. Picker dismissal
  while a write is busy remains review-2 N6, not a new N1 regression.
- **Hidden-window quit on Windows/Linux:** the non-macOS close branch destroys
  the window rather than hiding it, so this checkout has no ordinary path to a
  hidden, dirty non-macOS handle. `is_visible().unwrap_or(true)` also fails safe
  on a visibility-query error. A packaged Windows/Linux run is still needed
  before claiming portability.

## Remaining should-fix classification before a local commit

| Item | Decision | Reason |
| --- | --- | --- |
| Review-2 N6 — picker Escape focus/error while busy | **MUST-FIX** | D9 requires focus return, and closing a busy picker can hide a failed write/error; both are user-visible draft-protection failures (`src/ui/detail/PickerField.tsx:46-95`). |
| Review-2 N7 — view reconciliation unregisters pending detail write | **MUST-FIX** | A route/list update can unmount the only pending source while its promise is unresolved, making native see `pending: false` and losing the failure UI (`src/screens/AppScreen.tsx:297-304`, `src/ui/detail/PickerField.tsx:84-95`, `src/lifecycle/drafts.ts:41-47`). |
| Review-2 N8 — detached native workers lack shutdown/cancellation | **FOLLOW-UP** | It is a lifecycle robustness gap that needs packaged exit/reopen evidence, but no current unit/source path demonstrates data loss or a second window; document it and close it before packaged release. |
| Review-2 N9 — mount-stable readiness instance | **MUST-FIX** | Stale ready/unready calls can make a live bridge appear dead, and it compounds NEW-4 (`src/lifecycle/useDesktopLifecycle.tsx:48-105`, `src-tauri/src/lib.rs:36-54`). |
| Original 5 — one-pixel monitor overlap accepted as usable | **MUST-FIX** | It violates D2's visible/usable geometry guarantee and can strand the controls after monitor removal (`src-tauri/src/lib.rs:468-513`). |
| Original 8 — closed sidebar remains focusable/visible to assistive tech | **MUST-FIX** | D6-D9 require usable keyboard/focus behavior; the off-screen layer lacks inert/`aria-hidden` and containment (`src/ui/Shell.tsx:66-71`, `src/ui/Shell.module.css:34-56`). |
| Original 9 — readiness lacks mount/window generation | **MUST-FIX** | E2 requires stale lifecycle signals to be discarded; the current instance-only bridge/native commands cannot distinguish old cleanup from a replacement (`src/lifecycle/useDesktopLifecycle.tsx:48-105`, `src-tauri/src/lib.rs:36-54`). |
| Second `take_exit_bypass` assertion | **FOLLOW-UP** | `take_exit_bypass` clears the option on the first successful take (`src-tauri/src/lifecycle.rs:262-273`); asserting a second take is false is valuable regression coverage but not an independent observed defect. Add it before packaged lifecycle sign-off. |

## Merge-readiness verdict

**MERGE-READINESS: NOT READY TO MERGE.** N1-N3's original paths are fixed, but
N4/N5 remain partial and NEW-1/NEW-2 can lose an explicit close/quit decision;
N6, N7 and the D2/D6-D9/E2 readiness items are must-fix before a local commit.
The green web/native unit suites do not establish packaged macOS behavior, so
that evidence remains a separate release gate even after the source-level
must-fixes land.
