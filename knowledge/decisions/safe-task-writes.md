---
type: Decision
title: "Named-field task writes"
description: "Use the bulk endpoint for single-task patches and echo server subresources; partial single-task POST and empty fields can erase data."
status: stable
date: 2026-09-15
tags:
- writes
- bulk
- patch
- reminders
- assignees
- data-loss
sources:
- resource: docs/HANDOVER.md
- resource: docs/data-model-mapping.md
- resource: src/api/integration.write.test.ts
code_refs:
- src/api/endpoints.ts
- src/queries/useUpdateTask.ts
- src/queries/useCompleteTask.ts
last_updated: 2026-09-16
---

# Named-field task writes

## Context
Vikunja 2.5.0's single-task POST reapplies omitted fields as zero values. A minimal done toggle would erase dates, description, priority, recurrence and subresources.

## Decision
D-write introduced `updateTask` through `POST /tasks/bulk` with a nonempty named fields list (`286c934`). The caller supplies a server-issued Task and the endpoint echoes reminders/assignees. Reminder-only writes use updateReminders and name the unchanged title (`4d61e7c`).

## Reasoning
The fields branch preserves unnamed columns, but reminders and assignees live outside that guard. Empty fields means no protected columns, not no column changes. Choosing title for the reminder no-op avoids advancing recurrence through done or resetting a bucket through project_id.

## Alternatives considered
Read-modify-write on the single-task route adds a round trip and still risks stale replacement. The v2 PATCH surface was not adopted. Hand-built task objects cannot distinguish omitted subresources from deliberate removal.

## Consequences
Cached title echo has a concurrent-rename race. Nonrecurring completion gets optimistic rollback and short Undo; recurring completion advances dates and has no honest inverse. Preserve explicit live-write opt-in and server-copy read-backs.

## Related
- [Architecture](/architecture/architecture.md) — hooks and cache updates
- [Add a task mutation](/playbooks/add-task-mutation.md) — implementation and regression checks
