# Delta review: Tauri desktop shell

Reviewed 2026-09-17 against the uncommitted working tree, the original
`tauri-desktop-shell-review.md`, and `tauri-desktop-shell.md` requirements D3,
D4, D5/D13, D9, and E2. This review is read-only except for this report; the
verification documents were not changed.

## Verification

- `pnpm test`: passed, 39 files and 678 tests; 2 files and 19 tests skipped.
- `pnpm check`: passed Biome (152 files), TypeScript, and the design-token check.
- `PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml`: passed, 13 native lifecycle tests.
- No `tauri build` or packaged macOS, WebView, monitor, Finder/Dock, sleep/wake, or Command-Q run was performed.

## Blocker status

| Original blocker | Status | Current evidence | Test evidence |
| --- | --- | --- | --- |
| 1. Missing-window recreation on the UI thread | **RESOLVED** | `src-tauri/src/lib.rs:383-396` takes the recreation slot and drops the coordinator mutex before `std::thread::spawn`; `:399-423` calls `WebviewWindowBuilder::build()` outside that mutex and calls `finish_recreation(result.is_ok())` afterward. `src-tauri/src/lifecycle.rs:106-114` advances generation only for a successful build. | Rust `recreation_is_serialized_and_generation_advances_after_success` (`src-tauri/src/lifecycle.rs:439-448`) proves serialization and failed-build generation stability. It does not prove a real runtime builder on macOS/Windows. |
| 2. Command-Q mutating a close attempt | **PARTIALLY RESOLVED** | `src-tauri/src/lifecycle.rs:138-166` now leaves the close attempt immutable, clears it, allocates a new attempt, and `request_lifecycle` re-emits `lifecycle:request` for the new ready attempt (`src-tauri/src/lib.rs:194-205`). Old decisions/recovery callbacks compare the attempt identity (`src-tauri/src/lifecycle.rs:169-217`). The timeout still has a check-then-side-effect race (`src-tauri/src/lib.rs:237-250`), and the frontend can drop a superseding request (`src/lifecycle/useDesktopLifecycle.tsx:95-115`). | Rust `close_then_quit_supersedes_the_close_attempt`, `timeout_from_superseded_attempt_is_stale`, and `recovery_decision_from_superseded_attempt_is_stale` (`src-tauri/src/lifecycle.rs:380-436`) prove the no-interleaving state transitions. No test proves the actual re-emission or the timeout/dialog/decision ordering in a running WebView. |
| 3. Pending-write guard missing task-detail writes | **PARTIALLY RESOLVED** | The picker and completion paths now register pending state (`src/ui/detail/PickerField.tsx:46-52`, `src/queries/useCompleteTask.ts:45-50,101-143`); editors, comments, subtasks, Quick Add, and setup/login also call `useDraftSource`. Task-detail close/backdrop/navigation controls are guarded (`src/ui/detail/TaskDetail.tsx:107-128,210-256`), and editor Cancel is disabled while saving (`src/ui/detail/EditableField.tsx:178-184`). A pending detail can still be unmounted by route/view reconciliation, which unregisters its source while the promise is unresolved (new finding N7). | `TaskDetail.test.tsx:412-430` proves a mounted picker blocks detail close until settle; the completion pending test (`src/queries/useCompleteTask.test.tsx:62-73`) proves registration and unmount cleanup. There is no all-write-path or unmount-during-pending test. |
| 4. Picker is not topmost for Escape | **PARTIALLY RESOLVED** | `src/ui/overlayStack.tsx:25-67` gives picker priority over dialog and sidebar and captures Escape centrally; `PickerField` registers only while open (`src/ui/detail/PickerField.tsx:51-52`). The original picker/sidebar ordering is therefore corrected. The same capture listener closes a TaskDetail while focus is in its editor because it does not honor the dialog's typing guard (`src/ui/detail/TaskDetail.tsx:145-162`); picker close also has no focus return (N6). | `Shell.test.tsx:125-151` proves the synthetic registered-picker ordering, and `TaskDetail.test.tsx:499-507` proves the standalone picker behavior. The latter is not rendered under the application `OverlayStackProvider`, so it cannot catch the editor regression. |

## Current findings

### N1 — Blocker: global Escape capture discards an active task editor

**Locations:** `src/app/App.tsx:44-52`, `src/ui/overlayStack.tsx:49-67`,
`src/ui/detail/TaskDetail.tsx:123-128,145-162`.

`App` places the stack around the real application. Its window capture handler
stops propagation and calls the top `dialog` layer before `TaskDetail`'s own
window bubble handler can inspect whether focus is in an input. Thus a user can
open a task, type in the title, and press Escape: the stack invokes
`closeTaskDetail`, the detail unmounts, and the only editor copy is discarded.
The same applies to the description, comment, and subtask controls. The
standalone TaskDetail Escape test passes because it has no provider. The stack
needs a target-aware dialog callback or the editor needs a capture-phase guard.

### N2 — Blocker: a stale authorized attempt can still perform the native action

**Locations:** `src-tauri/src/lifecycle.rs:189-195`,
`src-tauri/src/lib.rs:57-75,316-350`.

`decide` clears `active` and returns `Authorized(attempt)`, after which the
command finalizes that copied attempt without re-validating its generation or
ownership. If a second close/quit request starts, or a replacement window
advances generation, before `finalize_attempt` runs, the old finalizer can hide
or destroy the replacement window, call `app.exit(0)`, or arm the one-use exit
bypass that lets a later `ExitRequested` through. This is a concrete stale
attempt path that still authorizes an action; the current unit tests do not pause
between `decide` and finalization.

### N3 — Blocker: hidden-window Command-Q is not a direct quit path

**Locations:** macOS close hides the handle at `src-tauri/src/lib.rs:326-334`;
Command-Q goes through `src-tauri/src/lib.rs:134-155,172-205` and determines
`has_window` only by `get_webview_window(...).is_some()` (`:177`).

After a clean close, or after an unresponsive close where the user selected
“Close anyway”, the main handle can remain present but hidden and the frontend
can be unready. Command-Q therefore starts another frontend request or native
recovery dialog instead of exiting directly. If the hidden WebView is suspended,
the user waits for the five-second timeout and must answer recovery; the native
`quit_without_a_window_can_exit_directly` test covers only a genuinely absent
handle (`src-tauri/src/lifecycle.rs:450-457`). Treat a hidden main window as the
no-visible-window quit case, while retaining the dirty/pending guard when the
window is visible.

### N4 — Should-fix: a superseded timeout can mark the current frontend unready

**Locations:** `src-tauri/src/lib.rs:224-250`.

The timeout checks `is_active(&attempt)` under the mutex, unlocks, then calls
`frontend_lost()` unconditionally. If that check wins just before Command-Q
supersedes the close with a new attempt, the old timeout clears readiness for the
new request and then fails to open recovery because its attempt is stale. The
next close uses native recovery despite a live frontend. Make the active-attempt
check and readiness transition one conditional state operation.

### N5 — Should-fix: a stale frontend response can clear the superseding request

**Location:** `src/lifecycle/useDesktopLifecycle.tsx:95-115`.

While `invoke("lifecycle_decision")` for close A is pending, native Command-Q
can emit request B and React can render B. When A's invoke resolves, its
unconditional `setRequest(null)` clears B; `respondingRef` also suppresses B's
button while A is in flight. Native B then remains active until timeout/recovery,
even though the frontend appears to have stopped displaying the guard. Clear
only if the current request still has A's attempt ID and generation.

### N6 — Should-fix: picker Escape has no focus return and can hide a failed write

**Locations:** `src/ui/detail/PickerField.tsx:46-52,54-82,84-120`.

The picker stack callback only calls `setOpen(false)`; it does not focus the value
button. Escape therefore removes the focused picker control and leaves focus at
the document/body instead of returning to the trigger. Also, Escape or an
outside mousedown can close the popover while `busy`; if the request then fails,
the error is stored but rendered only inside the now-closed fieldset. The user
sees the old value with no failure explanation. Preserve focus and keep the
picker/error visible (or disallow dismissal) while the write is pending.

### N7 — Should-fix: view reconciliation can unregister a pending detail write

**Locations:** `src/screens/AppScreen.tsx:297-304,375-405`,
`src/ui/detail/PickerField.tsx:84-95`, and `src/lifecycle/drafts.ts:41-47`.

`openTask` is derived from the currently visible list. A project/date pick can
move the task out of the current view, or navigation can change the view, while
the mutation is still unresolved. `TaskDetail` then unmounts, its registry
cleanup removes the picker source, and the native close bridge can observe
`pending: false` while the promise is still on the wire; a later failure has no
mounted error UI. Keep the pending operation registered independently until its
promise settles, or defer the unmount/navigation.

### N8 — Should-fix: detached native workers have no shutdown/cancellation path

**Locations:** `src-tauri/src/lib.rs:230-251,395-434`.

Both timeout and recreation work use detached `std::thread::spawn` calls and
drop their JoinHandles. A close/reopen racing application exit can leave a
worker using `AppHandle` after the event loop is shutting down; a recreation
worker can also continue into `build()` after the app no longer wants a window.
The spawn call has no recoverable error path if the OS refuses a thread. Gate
completion on an app-lifetime token and handle/record the spawn failure, or use
the runtime's cancellable async task facility.

### N9 — Nit: settled draft sources are hidden, not unregistered

**Locations:** `src/lifecycle/drafts.ts:41-59,74-86`.

Every current source updates to `pending: false` on settle, so
`getDraftSummary().sources` filters it out; cleanup unregisters it on component
unmount. The backing `sources` map nevertheless retains inactive entries for the
life of each mounted component, and the tests do not assert cleanup after every
write path. This is not an observed pending-state leak, but if “unregister on
settle” is literal, use operation-scoped registration or add an explicit settle
cleanup assertion.

## Residual first-review findings

These were not fixed by the blocker delta and remain outside the new findings:

- The usable-geometry check still accepts any one-pixel monitor overlap
  (`src-tauri/src/lib.rs:447-473`; original Should-fix 5).
- The closed sidebar remains mounted without `inert`/`aria-hidden` and has no
  focus containment (`src/ui/Shell.tsx:66-71`; original Should-fix 8).
- Frontend readiness still uses one mount-stable instance ID, and native
  `lifecycle_ready`/`lifecycle_unready` has no generation token
  (`src/lifecycle/useDesktopLifecycle.tsx:36-40,72-91`,
  `src-tauri/src/lib.rs:36-53`; original Should-fix 9).
- `bypasses_are_one_use_and_generation_bound` asserts only the first take is
  true (`src-tauri/src/lifecycle.rs:460-464`); it does not assert the second take
  is false.

## Final verdict

**BLOCKED — Blockers 2–4 are only partially resolved, and N1–N3 leave stale
authorization, hidden-window quit, and draft-loss paths; no packaged macOS
evidence was run.**
