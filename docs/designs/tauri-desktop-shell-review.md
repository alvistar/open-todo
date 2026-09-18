# Independent implementation review: Tauri desktop shell

Reviewed 2026-09-17 against `docs/designs/tauri-desktop-shell.md`, the
uncommitted working tree, `CLAUDE.md`, and `knowledge/project/conventions.md`.
The specification and `docs/designs/` were treated as review input; no changes
were made to them or to implementation files.

## Verification

- `pnpm test`: passed, 39 files and 674 tests; 2 files and 19 tests skipped.
- `pnpm check`: passed Biome (151 files), TypeScript, and the design-token
  check.
- `PATH="$HOME/.rustup/toolchains/1.88.0-aarch64-apple-darwin/bin:$PATH"
  cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `git diff --check`: passed.

No `cargo build`, `tauri build`, or packaged macOS/system interaction run was
performed. The green suite is therefore useful evidence for the pure
coordinator and React paths, but it does not establish the packaged-window,
single-instance, macOS, WebView, or sleep/wake requirements.

## Verdict

The implementation has a good foundation: the single-instance plugin is
registered first, macOS close uses `hide()` rather than destroying the process,
the native mutex is not held across event emission or finalization, and the
HTTP/persistence primitives are thoughtfully defensive. It is not ready to
merge against the desktop-shell specification because the findings below can
hang or silently bypass required close/pending-write protections.

## Ranked findings

### Blocker 1 — Missing-window recreation is scheduled on the UI thread

**Requirements:** D3, D4, and the E2 native lifecycle safety requirement.

**Location:** `src-tauri/src/lib.rs:378-410`.

`activate_main_window` puts `recreate_main_window` inside
`run_on_main_thread`, and that callback synchronously calls
`WebviewWindowBuilder::build()`. Tauri/Wry's runtime builder documents that
window creation must be done from a separate thread because the event-loop
channel can deadlock when creation is called synchronously on the UI thread
(the Tauri builder also warns about synchronous-event-handler deadlocks).

Concrete scenario: a non-macOS close destroys the last window, or a native
window disappears, and the user launches a second instance. The single-instance
callback queues this function; if `build()` waits for the event loop while that
same loop is executing the callback, the app stops processing and no main
window appears. The code has no timeout or recovery for this path. Window
creation should be serialized outside the UI callback using the runtime-safe
async/separate-thread API, with an explicit “recreation already in progress”
guard.

### Blocker 2 — Command-Q mutates an existing close attempt and invalidates its response path

**Requirements:** D4, D5/D13, and E2 (attempt identity, stale/duplicate
responses, and no silent destruction when the frontend is unavailable).

**Locations:** `src-tauri/src/lifecycle.rs:112-123`,
`src-tauri/src/lib.rs:230-250`, and `src-tauri/src/lib.rs:260-313`.

When a close attempt is active, `begin(Quit, ...)` changes the active attempt's
`kind` from `Close` to `Quit` in place. The timeout and native recovery code
retain the original `LifecycleAttempt`, and both `is_active` and `recover`
compare the complete attempt, including `kind`.

Concrete scenario: the user clicks the window close button, the frontend does
not respond, and then presses Command-Q while the five-second timeout or
recovery dialog is pending. The coordinator now contains the mutated Quit
attempt, but the timeout/dialog owns the old Close attempt; the timeout exits
without opening recovery, or a visible recovery dialog's decision is ignored.
The active request can remain stuck forever, and a late frontend response can
be interpreted with the wrong action kind. Keep an immutable attempt identity,
or explicitly supersede/cancel and replace the attempt while correlating every
timeout, dialog callback, and frontend response to the current generation and
attempt.

### Blocker 3 — The pending-write guard does not cover every task-detail write

**Requirements:** D5 and D13: every dirty/pending close must defer destructive
closure, while “exit anyway” remains an explicit choice.

**Locations:** `src/lifecycle/drafts.ts:74-85`,
`src/ui/detail/PickerField.tsx:44-90`, `src/screens/AppScreen.tsx:99-104`
and `src/screens/AppScreen.tsx:388-405`, and
`src/queries/useCompleteTask.ts:53-57,98-139`.

The close bridge only sees sources registered with `useDraftSource`. The text
editors, comments, subtask composer, setup, and quick-add register, but the
project/date/priority/label/reminder picker commits use `PickerField`'s local
`busy` state and never register it. Completion also tracks an in-flight write
in a ref without registering it. The bridge can consequently see a clean,
non-pending summary while one of these requests is on the wire.

Concrete scenario: open a task, choose a project/date/label/reminder, and
immediately press Command-Q (or close the detail). The native action receives
`pending: false` and can hide/destroy the window before the request completes;
if the request fails, the picker and its error are gone. The same loss is
possible while completing a task. Register all mutation lifetimes in the
shared draft/pending registry, or make the mutation coordinator itself part of
that registry before allowing a destructive action.

There is a second pending-editor path in the same area: `EditableField` leaves
its Cancel button enabled while `saving` and `TaskDetail` exposes direct
`onClose` handlers (`src/ui/detail/EditableField.tsx:117-132,178-193` and
`src/ui/detail/TaskDetail.tsx:200-248`). A user can cancel/close while the
save is in flight, unmounting the only draft copy and suppressing the eventual
failure. Disable those close paths or route them through the same pending
decision.

### Blocker 4 — Shell Escape detection does not identify the picker as the topmost layer

**Requirements:** D6-D9, especially D9's “Escape dismisses only the topmost
layer” rule.

**Locations:** `src/ui/Shell.tsx:50-64` and
`src/ui/detail/PickerField.tsx:57-75,106-115`.

The narrow Shell capture handler allows Escape through only when the event
target is inside `[role="dialog"]` or `[role="alertdialog"]`. PickerField
renders its open surface as a `fieldset`, not either role, and installs its
Escape listener in the bubbling phase. Therefore, with the sidebar open and a
picker focused, Shell's capture listener calls `stopImmediatePropagation()`
and closes the sidebar before PickerField can close itself.

Concrete scenario: at 390px width open the navigation, open a task's date or
label picker, focus a picker control, and press Escape. The navigation closes,
but the picker remains open; another Escape can then affect a different layer,
and the overlay state no longer matches the visible topmost surface. Use an
explicit overlay stack/topmost context (or give picker dialogs the correct
semantics and capture ordering) rather than inferring hierarchy from the
focused element's ancestor role.

### Should-fix 5 — “Visible” geometry accepts a window with only one pixel on a monitor

**Requirement:** D2 (usable geometry after restore and monitor changes).

**Locations:** `src-tauri/src/lib.rs:414-440` and `src-tauri/src/lib.rs:442-459`.

The fallback checks only whether the window rectangle intersects any monitor,
not whether a usable portion of the window is visible. A persisted window at
`x = -1179` with width 1180 can overlap a monitor by one pixel, satisfy
`visible`, and skip the default-size/center fallback. If the external display
was removed, most or all controls are then inaccessible and the user cannot
repair the geometry from the app. Require a meaningful visible area or clamp
the rectangle to a monitor, and add geometry tests for off-screen, negative,
zero/small, and monitor-removal cases.

### Should-fix 6 — Recovery timeout can mark a new/current frontend unready

**Requirements:** D4 and E2 (attempt/generation correlation and stale work
ignored).

**Locations:** `src-tauri/src/lib.rs:230-250` and
`src-tauri/src/lifecycle.rs:94-106`.

The timeout validates `is_active(&attempt)`, releases the mutex, then later
unconditionally calls `frontend_lost` through `mark_frontend_unready`. Between
those operations the frontend can answer, the attempt can be authorized, a
macOS window can be hidden, or a new window generation can become ready.

Concrete scenario: the five-second timeout wins its first lock just before a
late successful frontend decision; the continuation then clears readiness for
that still-mounted/new frontend. The next close takes the native recovery path
even though the UI is responsive, and a new window can be left marked
unready. Recheck the same attempt and frontend/generation under the lock while
transitioning to recovery, or make the state transition atomic.

### Should-fix 7 — Repeated Reopen events can queue duplicate recreation and reset readiness

**Requirements:** D3/D4 and E2 generation handling.

**Locations:** `src-tauri/src/lib.rs:356-410`.

If no `main` handle exists, every Reopen/second-launch activation queues a
recreation callback. There is no in-progress flag and
`recreate_main_window` calls `coordinator.new_window()` before `build()`.

Concrete scenario: two rapid Dock activations arrive while the first callback
is queued. Both callbacks see no window; the first builds `main`, while the
second attempts the same label, reports an error, and has already incremented
the generation and cleared the first frontend's readiness. Serialize activation
and only advance the generation after a successful build (or roll back the
state on failure).

### Should-fix 8 — Closed mobile sidebar remains in the keyboard/accessibility tree

**Requirements:** D6-D9 (responsive overlay, focus containment, and Escape
semantics).

**Locations:** `src/ui/Shell.tsx:66-100` and
`src/ui/Shell.module.css:34-56`.

The closed sidebar is moved off-screen with CSS but remains mounted without
`inert`, `aria-hidden`, or a focus trap. Opening it does not move focus into the
sidebar; closing only restores focus when `closeSidebar` is called through the
known callback. Keyboard users can tab into invisible navigation controls, and
focus can remain in a layer that the backdrop visually says is closed. Add
focus entry/return and modal containment, and mark the hidden layer inert (or
otherwise remove it from the accessibility tree).

### Should-fix 9 — React lifecycle readiness is vulnerable to effect remount races

**Requirements:** E2 and D5/D13's frontend bridge lifecycle.

**Locations:** `src/lifecycle/useDesktopLifecycle.tsx:34-91` and
`src-tauri/src/lib.rs:36-54`.

The bridge keeps one `instanceIdRef` across effect mounts and sends readiness
without a native window-generation or effect-generation value. In React
StrictMode or a rapid remount, an older async effect can finish after the new
effect and call `lifecycle_unready` with the same instance id, clearing the
new effect's readiness. The native side cannot distinguish those signals.

Concrete scenario: the app remounts the bridge while a listener/invoke is
still resolving; the stale cleanup runs after the replacement has called
`lifecycle_ready`. The next close is treated as frontend-unresponsive and
opens native recovery despite a live bridge. Give each mount a unique token
and make unready conditional on that token, or make native readiness include
the window generation and reject stale readiness changes.

### Nit 10 — Some native failures are log-only and the recovery contract is not observable

**Requirements:** D2/E2's credential-free diagnostic/recovery expectations.

**Locations:** `src-tauri/src/lib.rs:163-166`, `src-tauri/src/lib.rs:326-333`,
`src-tauri/src/lib.rs:378-381`, and `src-tauri/src/lib.rs:404-410`.

Geometry-save failures and recreation scheduling/build failures are logged but
not surfaced through a native dialog or a guaranteed existing-window
diagnostic. For example, a failed geometry save is invisible to the user, and
a recreation scheduling error leaves no window and no actionable recovery.
The normal frontend error event is useful when a window exists; add a small,
credential-free native fallback for no-window failures and test it.

## Requirement coverage

This section names each desktop-shell requirement that is unmet or only
partially established; “partial” includes an implementation that looks right
in unit tests but lacks the spec's required packaged/system evidence.

| Requirement | Assessment | Evidence / remaining issue |
| --- | --- | --- |
| D2 geometry | Partial | Defaults/minimums and window-state flags are present (`src-tauri/src/lib.rs:17-25`), but the any-overlap test is not a usable-geometry guarantee (Finding 5), and persistence failures are log-only. |
| D3 single instance | Partial/blocker | Registration order and one main label are correct (`src-tauri/src/lib.rs:88-100`); missing-window creation can deadlock and duplicate activations can reset readiness (Findings 1 and 7). |
| D4 macOS close/reopen/quit | Partial/blocker | macOS close hides and saves (`src-tauri/src/lib.rs:321-334`), and Reopen activates the existing handle (`src-tauri/src/lib.rs:156-157,356-375`), but the close/quit race and timeout race can leave the action stuck or wrongly recovered (Findings 2 and 6). No packaged macOS matrix was run. |
| D5/D13 dirty/pending guard and exit-anyway | Partial/blocker | The bridge/coordinator have dirty, pending, recheck, and exit-anyway states (`src/lifecycle/useDesktopLifecycle.tsx:93-139`, `src-tauri/src/lifecycle.rs:144-172`), but not all writes enter the registry and editor/picker close paths can unmount pending work (Finding 3). |
| D6-D8 responsive sidebar/overlay | Partial | CSS breakpoint, fixed overlay, backdrop, and viewport reset exist (`src/ui/Shell.tsx:26-48`, `src/ui/Shell.module.css:34-79`), but focus containment/hidden-tree behavior is incomplete (Finding 8); the test suite does not measure actual narrow/zoom/long-content layout. |
| D9 topmost Escape | Not met | Shell's role-based capture conflicts with PickerField's `fieldset`/bubble listener (Finding 4). The current test covers only a synthetic element already marked `role="dialog"` (`src/ui/Shell.test.tsx:89-105`). |
| D10 token verification | Code meets the listed branches; test/system evidence partial | Setup preserves the token on 401/network/5xx/parse and accepts only the explicit 403 exception (`src/screens/SetupScreen.tsx:193-219`); unit tests cover those classes (`src/screens/SetupScreen.test.tsx:122-146`). There is no packaged WebView verification against actual response bodies, proxy behavior, or CORS/TLS. |
| D11 HTTP consent/origin/transmission | Code meets the core rule; packaged evidence partial | Consent compares exact `URL.origin` and sensitive requests include bearer-token requests and anonymous bodies (`src/settings/transportPolicy.ts:21-33`, `src/api/http.ts:87-107`); stored-token startup is gated in the app (`src/app/App.tsx:22-50`). There is no packaged WebView/CORS/TLS test for the startup path, and malformed URLs intentionally fall through `requiresTransportConsent` as non-HTTP (`src/settings/transportPolicy.ts:21-26`), which deserves an explicit validation decision. |
| D12 persistence outcomes/retry | Implementation mostly meets; consumer evidence partial | Cached and durable values are separated, including retry of the same failed value/removal (`src/store/persistentValue.ts:69-119`), with notices in transport/auth consumers. The suite lacks blocked-storage/new-consumer/restart-level tests and does not exercise every user-visible persistence notice. |
| E2 Rust close coordinator | Not met | IDs/generation and one-use bypass primitives exist (`src-tauri/src/lifecycle.rs:20-26,195-205`), but mutable close-to-quit kind, stale timeout clearing, duplicate recreation, and native-thread recovery behavior produce the races in Findings 1, 2, 6, and 7. The bypass test does not assert the second take is false (`src-tauri/src/lifecycle.rs:364-369`). |
| E3 redirect behavior | Code appears to meet; test evidence partial | All requests use `redirect: "error"` in the shared send path (`src/api/http.ts:111-118`), including errors before parsing. Tests assert the option (`src/api/http.test.ts:60`), but there is no same-origin/cross-origin 301/302/307/308 fixture or packaged WebView check. |

## Test-map gaps

The implementation's green tests do not cover the following families called out
by the specification's test map:

- Native/system: persisted geometry after monitor removal and tiny/off-screen
  windows; Finder launch with Vite stopped; close/minimize/reopen/Command-Q;
  second launch and repeated activation; hidden-window Command-Q; WebView
  HTTP/HTTPS, CORS, CSP, TLS, and redirect behavior; sleep/wake without
  duplicate pollers.
- Native lifecycle races: callback-thread recovery, timeout versus frontend
  decision, close versus Command-Q supersession, stale/duplicate responses,
  generation replacement, failed recreation, and a second
  `take_exit_bypass` assertion.
- React lifecycle: late decision after unmount, listener cleanup/remount and
  StrictMode readiness, pending picker/completion writes, failed writes while
  closing, and every dirty/pending source in the registry.
- Responsive/accessibility: picker Escape while sidebar is open, nested
  dialog/confirmation ordering, focus entry/return and Tab/Shift+Tab around the
  mobile sidebar, resize during an open sidebar/detail/picker, minimum-window
  dimensions, long labels, and browser zoom.
- Transport/persistence: actual consent transmission at the final URL, stored
  session startup, exact-origin host/port changes in a real WebView, all
  redirect status classes, blocked storage for every consumer, retry after a
  failed unchanged write/removal, and restart/new-consumer behavior.

## Standards review

- `CLAUDE.md` and `knowledge/project/conventions.md` are generally followed:
  naming, Biome formatting, shared tokens, React idioms, and failure-preserving
  editor behavior are consistent with the surrounding code. The new Rust and
  React code has more explanatory comments than nearby legacy code, but its
  density and style are internally consistent; the missing concurrency
  invariants are a correctness issue, not a comment-style violation.
- No second unsafe task-field write path was found. `updateTask` remains the
  bulk task-field writer, while reminder/label/comment/subtask calls are their
  declared subresources (`src/api/endpoints.ts:228-298`).
- No Todoist asset was found in the shipped source/configuration; the desktop
  icon is the open-todo checkmark. A few test comments use Todoist as a
  research comparison, but no asset or runtime dependency is introduced.
- The review itself respects the requested read-only scope; only this report
  file was created.

## Final verdict

**BLOCKED — do not merge the Tauri desktop shell until Findings 1–4 are fixed,
the native race/packaged test families are exercised, and the remaining partial
D2/D3/D4/D6-D12/E2/E3 evidence is closed.**
