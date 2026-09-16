---
type: Reference
title: "Architecture"
description: "How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact."
tags:
- architecture
- flow
- cache
- routes
- integration
- tasks
sources:
- resource: README.md
- resource: docs/HANDOVER.md
- resource: docs/data-model-mapping.md
- resource: src/queries/client.ts
- resource: src/api/endpoints.ts
code_refs:
- src/main.tsx
- src/app/App.tsx
- src/screens/AppScreen.tsx
- src/queries/useUpdateTask.ts
- src/live/useLiveSource.ts
last_updated: 2026-09-16
---

# Architecture

## System Overview
`main.tsx` mounts StrictMode and QueryClientProvider. `App` gates on a stored URL and credential; setup authenticates directly with Vikunja. `AppScreen` resolves a hash route into a ViewDef, queries server data, derives task rows, and wires the composer/detail actions. User intent flows through a model helper and mutation hook to the HTTP client and `/api/v1`; server responses and invalidations update the shared query cache. There is no intermediate application service.

## Key Components
- **API boundary** — typed errors, URL normalisation and paginated collection reads. Pagination ends on a short page even when CORS hides count headers.
- **Model boundary** — priority/date conventions, Inbox resolution, view membership, parent-only subtask visibility, display conversion and parsing.
- **Query boundary** — initial reads and mutations. Detail writes publish the server task into cached lists before invalidating; labels require a GET read-back, comments have their own query key, and subtask creation writes the child then the parent relation.
- **Live boundary** — PollingSource emits reset/upsert/delete. Incremental requests are deliberately unfiltered by view; `belongs()` reconciles membership. Full fetches discover removals and invalidate other task-count queries.
- **Interaction boundary** — ListView owns roving keyboard focus; TaskDetail owns editing/pickers/comments/subtasks. Completion uses a short-lived pending overlay before grouping so the Undo row survives a server refetch.

## External Dependencies
The configured Vikunja instance is the only remote application dependency. The recorded API probes targeted 2.5.0; rerun explicitly authorised integration tests after a server upgrade rather than assuming later versions match. Browser storage persists configuration/credentials and preferences, not an offline task replica.

## What Does NOT Exist Here
No proxy, backend database, SSR, webhook receiver or Todoist protocol shim. No WebSocket implementation currently feeds the live layer. No persisted drag ordering or general undo service is implemented. Those boundaries are not invitations to silently add them.

## Related
- [Stack](/project/stack.md) — technology and dependency constraints
- [State](/project/state.md) — current features and missing work
- [Quick-add pipeline](/architecture/quick-add.md) — the deeper parser domain
- [Polling](/decisions/polling-live-source.md) — why two fetch shapes exist
