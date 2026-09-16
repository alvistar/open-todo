---
type: Reference
title: "Conventions"
description: "How code is written in this project — naming, structure, patterns, and the checks most likely to catch a mistake here. Load when writing or reviewing code."
tags:
- conventions
- style
- tests
- verification
- review
- structure
sources:
- resource: CLAUDE.md
- resource: biome.json
- resource: docs/data-model-mapping.md
- resource: docs/layout-specs.md
- resource: DESIGN.md
code_refs:
- biome.json
- src/model/views.ts
- src/api/endpoints.ts
- scripts/sync-design-tokens.mjs
last_updated: 2026-09-16
---

# Conventions

## Naming
Components and their CSS Modules use PascalCase; hooks use `use…`; pure model files use descriptive camelCase names. Tests are colocated as `*.test.ts` or `*.test.tsx`. Biome enforces two-space indentation, double quotes, semicolons, trailing commas and a 90-column formatter width.

## Structure
Keep HTTP/protocol work in `api/`, pure interpretation in `model/`, remote cache coordination in `queries/`, polling in `live/` and rendering in `ui/`. `AppScreen` connects those layers. The project uses English records and UI strings. Source navigation belongs to native search, not the knowledge bundle.

## Patterns
A `ViewDef` couples its server filter with `belongs()`; client-only `includes()` excludes subtasks because the server filter cannot express parentlessness. Reuse `updateTask(http, serverTask, {priority: value})`, not a new partial POST to a task URL. Label/comment/relation writes are separate resources. Use semantic shipped tokens instead of raw colours; generate DESIGN.md's token block from CSS, not the reverse. Keep the original asset and MIT/public-API boundaries in the direct API and branding decisions.

## Verify Checklist
- [ ] For each changed boundary, read the relevant source and its mapping/specification; correct stale knowledge rather than copying older status prose.
- [ ] Run the relevant colocated tests using the commands in CLAUDE.md; include rejection/inert cases for parsing and failures/rollback for mutations. Record checks not run.
- [ ] Run the applicable lint/type checks and standalone version/design drift guards; generated files must agree with their sources.
- [ ] A changed view must preserve server/client membership, browser timezone and subtask filtering; incremental fetches must still observe departures.
- [ ] A changed write must preserve unnamed fields and echoed subresources; live write tests require deliberate opt-in, not ordinary validation.
- [ ] A changed interaction needs keyboard/focus and failure-state coverage; StrictMode lifecycle and Undo require checking beyond a happy-path render.
- [ ] If knowledge or governed code changed, update concepts/dates/log and drift bindings, then run the repository knowledge gate. Read publication instructions before any landing; no automatic push/PR.

## Related
- [Architecture](/architecture/architecture.md) — layer boundaries
- [Safe task writes](/decisions/safe-task-writes.md) — the destructive API behaviour behind the write rule
- [Amend quick-add](/playbooks/amend-quick-add.md) — grammar-specific checks
