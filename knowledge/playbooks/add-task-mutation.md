---
type: Playbook
title: "Add a task mutation"
description: "Extend task editing without erasing unrelated fields; use server task copies, named bulk fields, subresource read-backs and focused tests."
tags:
- mutation
- editing
- bulk
- reminders
- labels
- comments
sources:
- resource: docs/data-model-mapping.md
- resource: src/api/integration.write.test.ts
- resource: src/model/titleEdit.ts
code_refs:
- src/api/endpoints.ts
- src/api/write.test.ts
- src/queries/useUpdateTask.ts
- src/ui/detail/TaskDetail.test.tsx
last_updated: 2026-09-17
stale_after: 2026-12-17
---

# Add a task mutation

## Context
The most plausible implementation, a partial POST to one task, is destructive on the verified server. Relations and labels return something other than a Task.

## Steps
1. Read mapping §6 items 13–21 and identify a column change versus a subresource operation.
2. Extend TaskPatch/updateTask for supported columns; pass the server task unchanged. Use updateReminders for reminders and dedicated endpoints for labels, comments and relations.
3. Follow useUpdateTask writeBack for server copies, GET read-back after relation/label writes, and the separate comment query invalidation. Surface failure without dropping the draft.
4. Add focused assertions and run `pnpm test src/api/write.test.ts src/ui/detail/TaskDetail.test.tsx`; include titleEdit tests if parsing changes.
5. Only with deliberate live-write authorisation, use the opt-in integration command in CLAUDE.md. Timing was not measured during bundle setup; these recipes were read from source, not run here.

## Gotchas
`updateTask was asked to write no fields.` is a caller guard, not a server error. Do not bypass it to write reminders. `Updating task … did not return the updated task.` means the response did not contain a server task. Label/relation responses require rereading; a saved filter with a negative project id is never a destination.

## Verify
Assert that the outgoing fields name only intended columns and preserve reminders/assignees. An empty patch must fail before any HTTP call. A regression to single-task POST must fail the wire assertions. For a live upgrade probe, preserve the explicit empty-fields wipe test so a changed server contract is detected.

## Debug
Fields disappearing after a write → wrong route, empty fields, or a fabricated Task. Stale labels after attach → missing GET read-back. Repeated task showing Undo → completion logic ignored recurrence before the call.

## Related
- [Named-field task writes](/decisions/safe-task-writes.md) — why the guard is necessary
- [Architecture](/architecture/architecture.md) — query and UI ownership
