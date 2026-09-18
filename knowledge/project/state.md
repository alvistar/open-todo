---
type: Reference
title: "Current project state"
description: "What is working, what is not yet built, and what is known to be broken — a snapshot, not a history."
tags:
- state
- status
- features
- limitations
sources:
- resource: CHANGELOG.md
- resource: docs/HANDOVER.md
- resource: README.md
- resource: DESIGN.md
- resource: src/api/endpoints.ts
- resource: scripts/quickadd-corpus-diff.mjs
code_refs:
- src/screens/AppScreen.tsx
- src/ui/detail/TaskDetail.tsx
- src/ui/ListView.tsx
- src/model/views.ts
- src/model/titleEdit.ts
- src/app/App.tsx
- src/lifecycle/drafts.ts
- src/lifecycle/useDesktopLifecycle.tsx
- src/settings/transportPolicy.ts
- src/store/persistentValue.ts
- src/ui/Shell.tsx
- src/ui/overlayStack.tsx
- src-tauri/src/lib.rs
- src-tauri/src/lifecycle/mod.rs
- src-tauri/src/lifecycle/machine.rs
- src-tauri/src/lifecycle/runtime.rs
- src-tauri/src/lifecycle/tauri_runner.rs
- src-tauri/src/lifecycle/terminate.rs
- src-tauri/tauri.conf.json
last_updated: 2026-09-18
stale_after: 2027-03-18
---

# Current project state

**Working:**
- Static React SPA with server setup, password/TOTP or API-token login, hash routes and light/dark themes.
- Inbox, Today and project lists with polling, browser-timezone dates, sidebar counts and parent-only subtask placement.
- English/Italian quick-add with dates, sigils, recurrence, literal quoting and user-controlled recognition chips.
- Optimistic completion with rollback and a brief Undo window; recurring completion reports the advanced date without Undo.
- Keyboard list navigation with Up/Down or J/K, Enter to open, E to complete/reopen and Z to undo.
- Task detail edits title/description, date, priority, project and reminders; title parsing previews metadata before Save.
- Detail supports label attach/detach/create, reading/adding comments and creating subtasks in their parent's project.
- Portable Tauri v2 desktop shell with VERSION-derived metadata, bundled production assets, a stable application identifier, restricted CSP, standard decorations and origin-separated web storage.
- Tauri window-state restoration with usable-geometry fallback, single-instance activation, macOS close/reopen/quit lifecycle and a shared dirty/pending close guard with native recovery, driven by an explicit state machine (`lifecycle/machine.rs`) on a single-owner event loop (`lifecycle/runtime.rs`) with a Tauri effect runner (`lifecycle/tauri_runner.rs`); six proptest invariants and trace equivalence with the previous coordinator are in the test suite.
- Every macOS quit path reaches the machine: `lifecycle/terminate.rs` adds AppKit's `applicationShouldTerminate:` at runtime (objc2 0.6.4, macOS only), so ⌘Q, File → Quit, Dock → Quit, the App Switcher and `osascript … to quit` take the blocking `exit_requested()` round-trip — `Allow` answers NSTerminateNow, `Prevent` answers NSTerminateCancel with a Quit attempt already begun, and an authorised quit ends in `Effect::Exit` → `app.exit(0)` → a second `ExitRequested` answered Allow. No custom menu was added.
- The ask no longer times out while the person reads it: the bridge sends `lifecycle_acknowledge` (a Tauri command) once per (attemptId, requestSequence) when its dialog mounts, `Event::Acknowledged` sets `acknowledged: true` on `State::Asking`, and `Asking × Timeout` while acknowledged only logs "acknowledged; waiting for the person" instead of raising the native dialog. Every re-emit resets the flag.
- Responsive shared layouts: Todoist-shaped narrow sidebar overlay/backdrop/toggle, stacked task detail, wrapped quick-add/setup/dialog controls and Escape/focus handling. The explicit overlay stack gives picker > dialog > sidebar precedence, and dialogs decline Escape while typing.
- The shared draft/pending registry covers quick-add, title/description editors, comments, subtasks, pickers, completion, server setup and login, so close/quit sees both unsaved text and in-flight writes.
- HTTP is still opt-in: credential headers and login bodies require origin-bound consent, and the HTTP client rejects redirects before following them.
- Critical server, credential and transport persistence operations return durability outcomes and surface failures without claiming restart persistence.

**Not yet built:**
- Persisted drag reorder, list sections backed by kanban buckets, and manually ordered Today via a saved-filter view.
- Upcoming, search, filter/label browsing and a Completed view; the current routed lists are Inbox, Today and projects.
- General undo toasts and task-delete UI; the delete endpoint exists for API use and test cleanup.
- OIDC login, token refresh, WebSocket task transport and notification wake-ups; the implemented live source is polling only.
- Rich-text editing, attachment UI and sharing administration; descriptions/comments are displayed as plain text.
- UI localisation beyond English; bilingual task parsing is not UI localisation.
- The packaged macOS app has launched and quit with Vite stopped, but the full authenticated packaged flow, close/reopen matrix, WebView transport probe and storage-failure matrix still need manual verification.
- Windows/Linux source portability is intentional, but their runtime and release builds are not verified.

**Known issues:**
- Handover historical sections still contain older feature summaries; current capability state is recorded here and in README.
- A child whose parent is absent from the open view is hidden from top-level lists by design.
- Reminder-only updates echo the cached title, so a concurrent rename can be overwritten; reminders/assignees also rely on a server-issued task copy.
- The 1050px responsive collapse threshold is a content-fit implementation choice, not a measured Todoist breakpoint.
- The locked native dependency graph currently requires Rust 1.88+; `tauri info` may report an older system Rust even when a rustup toolchain is available.
- DESIGN.md still records an unresolved owner decision about shipping measured non-accent palette values verbatim.
- The corpus-diff script defaults to git ref `d3d0a4a`, which is absent from this checkout; supply an existing compatible baseline explicitly.
- The old coordinator in `lifecycle/mod.rs` is still compiled and unused; design slice 6 deletes it and its 26 tests.
- **Quit skips the draft guard after a close-then-reopen (found by the pre-landing
  review, 2026-09-18, NOT yet fixed; verified by reading the code).**
  `machine.rs:972` latches `hidden_by_close` on any successful close, and it is
  cleared only by a window recreation or a cancel. `lib.rs::on_activate` shows the
  existing hidden window and sends no event, so after close → Dock reopen the machine
  still believes the window is hidden: `Idle{hidden_by_close} × Begin(Quit)`
  (`machine.rs:256`) goes straight to `ArmExitBypass + Exit` with no `EmitRequest`.
  A dirty draft is then lost to Command-Q without a dialog — the exact data loss the
  feature exists to prevent.
- **`window_exists` is hardcoded `true` at every production `Begin` site**
  (`lib.rs:143` and three others), so the `window_exists: false` arms are
  unreachable. With the window gone and no frontend ready, every quit takes a 5 s
  `AwaitingFrontend` timeout and is then denied by the recovery dialog's
  no-window branch, so the app cannot be quit.
- **An acknowledged ask never re-arms its timeout** (`machine.rs:735`). If the
  webview acknowledges and then dies, `Asking` is permanent: further quits and
  closes are answered "dup"/`PreventExit` and the app cannot be quit.
- **A failed non-macOS close leaves the exit bypass armed**, so the next quit takes
  the bypass branch and exits with no draft check.
- **Possible quit-time deadlock (found by the pre-landing review, 2026-09-18, not
  yet fixed).** `LifecycleHandle::exit_requested` (`lifecycle/runtime.rs`) blocks on
  an unbounded `recv()` and is called from Tauri's main run loop
  (`lib.rs::on_exit_requested`). The loop thread runs effects synchronously, and
  `TauriRunner::finalize` calls `window.hide()` and `save_window_state`, which are
  serviced on the main thread. A quit arriving while a close finalize is in flight
  can therefore have each thread waiting on the other: a silent, total UI freeze.
  The window is narrow but the failure mode is unbounded.
- The webview's `lifecycle_decision` command returns unit, so a `DecisionResult::Stale`
  rejection is invisible to the bridge, which settles its dialog anyway; a cancel
  raced against a recheck can appear to do nothing.
- The bridge's instance id lives in a `useRef` that survives a StrictMode remount, so
  in `pnpm desktop:dev` a late `lifecycle_unready` from the superseded mount can
  deregister the live bridge.
- No CI workflow runs `pnpm test` or `cargo test`; only the knowledge gate runs on a PR.
- Proptest counterexamples are not persisted (`src-tauri/proptest-regressions/` is
  absent and not ignored), so a property failure is not reproducible on the next run.
- One 5 s timeout serves both the grace wait for a late bridge and the ask; the design asks 2 s for the first.
- Slice 7 (commits `0818b3c`, `f9bfac5`) fixed both packaged-smoke findings and was verified by 134 Rust tests, 6 proptest invariants at 10 000 cases, clean `clippy -D warnings`, `pnpm check`, the Vitest lifecycle suite and `pnpm desktop:build` (both bundles). Packaged check on 2026-09-18: File → Quit and Dock → Quit on a clean app log `lifecycle exit prevented`, `lifecycle exit bypass armed`, `lifecycle exit allowed`, `lifecycle: exited`, and the owner confirmed by hand that ⌘Q with a dirty draft shows the web dialog. Smoke sequence 5b (a slow answer must no longer raise the native dialog) has not yet been re-run with the scripted checklist.
- The packaged bundle logs to stderr with `RUST_LOG` (`env_logger`); `.claude/skills/desktop-qa/SKILL.md` drives it through System Events.

## Related
- [Architecture](/architecture/architecture.md) — how the working features connect
- [Quick-add pipeline](/architecture/quick-add.md) — parser limits and the current implementation rather than old defect lists
