# Fix plan for review-3 findings

Source report: `docs/designs/tauri-desktop-shell-review-3.md` (quote it for every
reproduction). Base commit: `02669ee`. Branch: `alvistar/trevally`.

## Findings

| ID | Location | Seam under test | Reproduction (what the red test asserts) | Cause hypothesis | Area |
|----|----------|-----------------|-------------------------------------------|------------------|------|
| NEW-1 | `src-tauri/src/lifecycle.rs` `begin`/`authorize_finalize`/`finish_finalize`; `src-tauri/src/lib.rs` `finalize_attempt` | `LifecycleCoordinator` public methods (unit test in `lifecycle.rs`) | Close A authorized, `authorize_finalize(A)` returned Proceed (reservation held), then `begin(Quit, true)` arrives before `finish_finalize(A)`. Today `begin` returns `Ignore` and the quit is lost. The test asserts the quit is not lost: either `begin` returns a result that carries the quit as queued/superseding, or after `finish_finalize(A)` the coordinator reports a pending quit that `lib.rs` must re-emit. Second scenario (same ID, second test): active attempt awaiting decision, `begin_recreation()` succeeds, frontend `decide(Allow)`, `authorize_finalize` returns `Stale` only because recreation is in progress; after `finish_recreation(true)` the user's decision is gone. Assert the decision is preserved or the recreation is refused while an attempt is active. | `finalizing` and `recreation_in_progress` are boolean gates with no queued outcome; a legitimate event that overlaps a gate has nowhere to go. Fix at the state model: one explicit ordering policy (queue and replay after the gate clears, or refuse the overlap and re-request) rather than two more flags. | coordinator |
| NEW-3 | `src-tauri/src/lifecycle.rs` `begin_recreation`/`authorize_finalize`; `src-tauri/src/lib.rs` `recreate_main_window` | `LifecycleCoordinator` | Same as NEW-1 second scenario, independent of macOS hide timing: `begin_recreation` accepts while `active` is set. Assert `begin_recreation` refuses (or defers) while an attempt is active, or the decision survives recreation. | Same cause as NEW-1 second scenario; expect one fix to cover both. | coordinator |
| NEW-4 | `src-tauri/src/lifecycle.rs` `frontend_ready`/`timeout_expired`; `src-tauri/src/lib.rs` `schedule_recovery_timeout` | `LifecycleCoordinator` | Close A active in generation G with instance X ready; `frontend_ready("Y")` (remount); then `timeout_expired(A)`. Today it returns true and clears `frontend_instance`. Assert the timeout is stale when the ready instance changed after the attempt began, and Y stays ready. | Timeout ownership is keyed on attempt id only; it must also be keyed on the frontend instance (and generation) that was ready when the attempt began. | coordinator |
| N9 / Orig-9 | `src/lifecycle/useDesktopLifecycle.tsx` `instanceIdRef` and the ready/unready effect; `src-tauri/src/lib.rs` `lifecycle_ready`/`lifecycle_unready` | `DesktopLifecycleBridge` through Testing Library with `invoke`/`listen` mocked at the Tauri boundary; `LifecycleCoordinator` for the native side | Mount bridge (ready X), then a remount that mounts Y before X's cleanup runs (StrictMode order): the sequence is ready X, ready Y, unready X. Today `frontend_unready("X")` after `frontend_ready("Y")` must not clear Y. Assert the coordinator keeps Y ready, and the bridge sends a mount-stable instance token so a stale unready is discarded. Check the current `frontend_unready` guard: if it already compares instances, the red test must target the bridge ordering instead. | Instance comparison may exist natively but the bridge token is not mount-stable, and there is no generation in the token. Fix together with NEW-4: one token = (instance, generation) issued at ready time. | coordinator |
| NEW-2 | `src/lifecycle/useDesktopLifecycle.tsx` listener (`setRequest(event.payload)` around line 70) and `respond` (lines ~107-129) | `DesktopLifecycleBridge` via Testing Library, `invoke` mocked so its promise resolves under test control | (a) Request A rendered, user clicks a decision, `invoke` for A is pending; native emits request B; then A's invoke resolves BEFORE React commits B. Today `sameRequest(requestRef.current, A)` is true and `setRequest(null)` hides B. Assert B's dialog is visible after A resolves. The existing test "keeps a newer request visible when an older response resolves" resolves A only after B rendered; the new test must resolve A first. (b) Native re-emits the same attempt (recheck) while its first invoke is pending; user clicks Stay/Cancel. Today `respond` returns early because `respondingRef` equals the attempt. Assert a second `lifecycle_decision` invoke with `cancel` is sent. | `requestRef` is updated on commit, not in the listener; `respondingRef` blocks any second decision for the same attempt. Update the ref synchronously in the listener and let a current Cancel supersede an in-flight response. | bridge |
| N7 | `src/screens/AppScreen.tsx` open-task read-back (~297-304); `src/ui/detail/PickerField.tsx` pending registration (~84-95); `src/lifecycle/drafts.ts` | `getDraftSummary()` after rendering `AppScreen`/`TaskDetail` with a mocked API whose write promise is held open | Open a task, start a picker write (promise pending), then make the task leave the view (poll result without it) so the detail unmounts. Today the pending source unregisters and `getDraftSummary().pending` becomes false while the promise is unresolved. Assert `pending` stays true until the promise settles, and the failure of that write is still surfaced. | Pending state is owned by the component that unmounts. Move pending ownership to the registry (a pending write registered with its promise stays registered until settled, independent of the component). | drafts |
| N6 | `src/ui/detail/PickerField.tsx` (~46-95) | `PickerField` via Testing Library | (a) Open picker from its trigger, press Escape: today focus is not returned to the trigger. Assert `document.activeElement` is the trigger. (b) Start a write that rejects while the picker is open, press Escape before it settles: today the error is hidden. Assert the error remains visible (or Escape is declined while the write is busy, matching EditableField's "Cancel disabled while saving"). | Picker close handler does not restore focus and does not consider the busy/error state. | drafts |
| Orig-5 | `src-tauri/src/lib.rs` `ensure_usable_geometry` (~468) and `monitor_intersects` (~496) | `monitor_intersects` (make it a pure function over rectangles if it is not already; unit test in `lib.rs` or a new `geometry.rs`) | Window rect overlapping a monitor by 1×1 px is accepted as visible today. Assert it is rejected; assert a rect with the title bar and a minimum usable width/height on a monitor is accepted. Pick a threshold (e.g. at least min-size 360×420 intersection, or the whole title bar strip) and state it in the test. | Intersection test is non-empty instead of "enough of the window to be usable". | geometry |
| Orig-8 | `src/ui/Shell.tsx` (~66-71), `src/ui/Shell.module.css` (~34-56) | `Shell` via Testing Library at a narrow viewport | Sidebar closed at < 1050px: today its links are still focusable and exposed to assistive technology. Assert the closed sidebar has `inert` (or `aria-hidden` plus no tabbable descendants) and that Tab from the toggle does not land inside it. | The off-screen overlay is hidden visually only. | shell |

## Coordinator amendments during the run

- N9: hypothesis refuted by the worker and confirmed by the coordinator (`frontend_unready`
  already compares the instance; the bridge token is mount-stable). N9 is left out as an ID;
  its generation concern is folded into NEW-4 as a native readiness token (instance +
  generation) returned by `lifecycle_ready`.
- NEW-2(a): not reproducible at the bridge seam under `act()`. New pure seam in scope:
  `src/lifecycle/requestState.ts`, an attempt-aware request/response transition tested
  directly; the hook applies it. NEW-2(b) stays at the bridge seam.

## Checklist (every ID must be fixed or explicitly left out with a reason)

- [ ] NEW-1
- [ ] NEW-3
- [ ] NEW-4
- [ ] N9 / Orig-9
- [ ] NEW-2
- [ ] N7
- [ ] N6
- [ ] Orig-5
- [ ] Orig-8

## Deferred (coordinator decision, do not touch)

- N8 (detached native workers have no shutdown path): needs packaged exit/reopen evidence,
  not a unit fix. Stays in CHANGELOG Known gaps.
- Second `take_exit_bypass` assertion: add it only if you are already editing that test module;
  otherwise leave it.

## Out of scope

- `VERSION`, `CHANGELOG.md`, `README.md`, `docs/HANDOVER.md`, `knowledge/**` (the coordinator
  updates them after review).
- `src/model/**`, `src/api/**`, `src/queries/**`, `src/live/**` unless a reproduction test needs a
  mock at the API boundary (mock, do not edit).
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

All 15 tests in `src-tauri/src/lifecycle.rs` (in particular
`finalization_reservation_blocks_newer_actions_until_finished`,
`close_then_quit_supersedes_the_close_attempt`, `new_window_invalidates_old_frontend_and_attempt`),
all of `src/lifecycle/useDesktopLifecycle.test.tsx`, `src/ui/Shell.test.tsx`,
`src/ui/detail/TaskDetail.test.tsx`, `src/lifecycle/drafts.test.ts`. If NEW-1's ordering policy
makes `finalization_reservation_blocks_newer_actions_until_finished` assert the wrong thing,
ask before changing it: the reservation must still block a *stale* action.
