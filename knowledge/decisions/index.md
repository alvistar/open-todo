# Decisions

One concept per decision. A decision is worth recording when it is non-obvious, when it constrains future work, or when knowing *why* prevents a mistake — not for every choice made.

## How to record one

Create `decisions/<slug>.md`. The slug is permanent: OKF ids are paths, and renaming one breaks every link to it, so choose a slug that names the decision, not its current title.

```markdown
---
type: Decision
title: Fixtures must be independently derived
description: Python fixtures are derived from the spec, never from Rust output, so parity is a test and not a tautology.
status: stable
date: 2026-09-04
tags:
- fixture
- parity
sources:
- resource: docs/plans/2026-09-04-001-fixtures-plan.md
code_refs:
- core/fixtures/
last_updated: 2026-09-16
---

# Fixtures must be independently derived

## Context
## Decision
## Reasoning
## Alternatives considered
## Consequences

## Related
- [stack](/project/stack.md) — the parity this decision protects
```

Rules the gate enforces:

- `status` uses OKF's own vocabulary, which `okf validate --strict` enforces: `stable` for a decision in force, `deprecated` for one superseded (`draft` while it is still being discussed). `date` and `last_updated` are ISO dates.
- Every decision links to at least one concept **outside** `decisions/` — a decision that only points at other decisions is an island `okf validate` cannot see.
- A superseded decision is never deleted: set `status: deprecated`, add `Superseded by [title](/decisions/<new-slug>.md)` under `## Related`, and have the new decision link back. Deprecated decisions take no `stale_after`.
- Add a row below with the description verbatim.

## Index

- [Direct browser API](/decisions/direct-browser-api.md) — A static React SPA calls Vikunja directly; no proxy or SSR. Load before changing hosting, authentication custody or the application boundary.
- [Distinct brand and original assets](/decisions/distinct-brand.md) — Teal accent and original icons distinguish open-todo from the measured reference. Load when changing visual identity or importing assets.
- [Polling behind LiveSource](/decisions/polling-live-source.md) — Polling owns freshness until Vikunja exposes task events; unfiltered increments and full reconciliation serve different purposes.
- [Closed date grammar around chrono](/decisions/closed-date-grammar.md) — Chrono resolves dates but the application admits only approved grammar shapes, preventing ordinary task words from silently becoming dates.
- [Named-field task writes](/decisions/safe-task-writes.md) — Use the bulk endpoint for single-task patches and echo server subresources; partial single-task POST and empty fields can erase data.
- [Offer ambiguous repeat adverbs](/decisions/offer-repeat-adverbs.md) — A trailing daily or mensilmente is offered, not applied: user acceptance determines recurrence when text alone cannot distinguish intent.
