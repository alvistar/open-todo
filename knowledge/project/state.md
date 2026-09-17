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
- src-tauri/src/lifecycle.rs
- src-tauri/tauri.conf.json
last_updated: 2026-09-17
stale_after: 2026-12-17
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
- Tauri window-state restoration with usable-geometry fallback, single-instance activation, macOS close/reopen/Command-Q lifecycle and a shared dirty/pending close guard with native recovery.
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
- NEW-1: Command-Q arriving while an authorized macOS close is in `hide()` can be dropped, leaving the process running in the background.
- NEW-2: A React A/B lifecycle-request commit race can clear a newly emitted request; a same-attempt Cancel can also be dropped while an invoke is pending.
- NEW-3: Window recreation can invalidate a pending close/quit decision before native finalization.
- NEW-4: An old lifecycle timeout can clear a remounted bridge's readiness because timeout ownership is not tied to the frontend instance.
- N6: Picker Escape has no focus return and can hide a failed write/error.
- N7: View reconciliation can unregister a pending detail write while its promise is unresolved.
- N9: Lifecycle readiness has no mount/window-generation token to reject stale bridge signals.
- Usable-geometry accepts a one-pixel monitor overlap as visible.
- A closed sidebar is not inert, so off-screen navigation remains focusable/visible to assistive technology.

## Related
- [Architecture](/architecture/architecture.md) — how the working features connect
- [Quick-add pipeline](/architecture/quick-add.md) — parser limits and the current implementation rather than old defect lists
