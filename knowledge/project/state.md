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
last_updated: 2026-09-16
stale_after: 2026-12-16
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

**Not yet built:**
- Persisted drag reorder, list sections backed by kanban buckets, and manually ordered Today via a saved-filter view.
- Upcoming, search, filter/label browsing and a Completed view; the current routed lists are Inbox, Today and projects.
- General undo toasts and task-delete UI; the delete endpoint exists for API use and test cleanup.
- OIDC login, token refresh, WebSocket task transport and notification wake-ups; the implemented live source is polling only.
- Rich-text editing, attachment UI and sharing administration; descriptions/comments are displayed as plain text.
- UI localisation beyond English; bilingual task parsing is not UI localisation.

**Known issues:**
- README and handover feature summaries lag the implemented UI; older mapping paragraphs also describe parser defects already fixed.
- A child whose parent is absent from the open view is hidden from top-level lists by design.
- Reminder-only updates echo the cached title, so a concurrent rename can be overwritten; reminders/assignees also rely on a server-issued task copy.
- DESIGN.md still records an unresolved owner decision about shipping measured non-accent palette values verbatim.
- The corpus-diff script defaults to git ref `d3d0a4a`, which is absent from this checkout; supply an existing compatible baseline explicitly.

## Related
- [Architecture](/architecture/architecture.md) — how the working features connect
- [Quick-add pipeline](/architecture/quick-add.md) — parser limits and the current implementation rather than old defect lists
