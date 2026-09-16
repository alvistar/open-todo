---
type: Decision
title: "Polling behind LiveSource"
description: "Polling owns freshness until Vikunja exposes task events; unfiltered increments and full reconciliation serve different purposes."
status: stable
date: 2026-09-09
tags:
- polling
- refresh
- websocket
- reconciliation
- deletions
- clock
sources:
- resource: docs/HANDOVER.md
- resource: docs/data-model-mapping.md
- resource: src/live/reconcile.ts
code_refs:
- src/live/PollingSource.ts
- src/live/useLiveSource.ts
- src/queries/client.ts
last_updated: 2026-09-16
---

# Polling behind LiveSource

## Context
Verified Vikunja WebSockets expose notifications/timers rather than task changes; deleted_at is not filterable and a browser cannot receive webhooks.

## Decision
D6 (`498ea3c`) placed polling behind LiveSource. The implemented source polls visible tabs every 20 seconds and performs a full fetch every fifth tick, with wake-up and retry handling. TanStack's independent polling/focus refetch is off.

## Reasoning
Incremental changes must not include the active view filter: tasks leaving that view would disappear from the response. Full fetches and id-set comparison are needed for deletions. Server-relative durations avoid comparing a wrong browser clock to server timestamps.

## Alternatives considered
A notification-only socket cannot cover arbitrary task edits; webhook push needs a server excluded by D5. A future task-event socket can replace the source, but neither it nor notification wake-ups is implemented here.

## Consequences
Deletion visibility is bounded by full reconciliation, and other task-count queries refresh on resets. Preserve serialized ticks, forced-refresh queuing, cancellation and server-relative windows when modifying lifecycle code.

## Related
- [Architecture](/architecture/architecture.md) — cache reconciliation and membership
- [Debug a connection](/playbooks/debug-vikunja-connection.md) — distinguish stale views from transport failures
