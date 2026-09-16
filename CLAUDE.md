# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Before doing anything else, read `docs/HANDOVER.md` — start at its §0.**
It records the purpose, investigations, rejected approaches and decisions. Its
feature-status summaries (and the README's) can lag implementation; check current
code and `CHANGELOG.md` before choosing the next slice or declaring a feature absent.

## Project boundaries

open-todo is an MIT-licensed React + TypeScript + Vite SPA for self-hosted Vikunja.
The browser calls Vikunja directly; there is no application server or proxy.

- **Never `git push` or open a PR** without the owner's explicit go-ahead in the
  current session.
- **No Todoist code, bundles, icons, fonts, or logos** enter this repository.
  Reimplement measured behaviour with original code and assets. Vikunja's AGPL
  source is not copied either; use its public HTTP API. See handover §6.
- The language of record in the repository is English.

## Commands

Run from the repository root with pnpm:

```bash
pnpm install
pnpm dev                         # Vite dev server, normally http://localhost:5173
pnpm check                       # Biome + TypeScript + generated design-token check
pnpm lint                        # Biome only
pnpm format                      # Biome with automatic fixes (writes files)
pnpm typecheck                   # tsc -b
pnpm test                        # Vitest, one run
pnpm test:watch                   # Vitest watch mode
pnpm test src/model/quickadd/parse.test.ts       # Single test file
pnpm test src/model/quickadd/parse.test.ts -t 'pattern' # Filter test names
pnpm build                       # Version drift check + TypeScript + Vite -> dist/
pnpm preview                     # Serve the built bundle locally
```

Vitest uses jsdom, globals and `src/test/setup.ts` (jest-dom matchers); it discovers
`src/**/*.test.{ts,tsx}`. Default tests need no server. Live API tests are opt-in:

- Read-only: set `VIKUNJA_TEST_URL` and `VIKUNJA_TEST_TOKEN`, then run
  `pnpm test src/api/integration.test.ts`.
- Writes: additionally set `VIKUNJA_TEST_WRITE=1`, then run
  `pnpm test src/api/integration.write.test.ts`. This creates, mutates and deletes
  real scratch tasks; use it only when live writes are intended.

## Architecture and contracts

- `src/app/App.tsx` gates setup/authentication; `src/screens/AppScreen.tsx` wires
  routing, views, queries, live updates and task interactions. Routes use hashes
  (`#/inbox`, `#/today`, `#/project/:id`), so static hosting needs no URL rewrites.
- `src/api/` owns the HTTP protocol; `src/model/` holds pure domain logic;
  `src/queries/` coordinates TanStack Query and mutations; `src/live/` reconciles
  server changes into the cache; `src/ui/` renders lists, the composer and detail.
- A `ViewDef` in `src/model/views.ts` pairs a server filter with a client
  `belongs()` predicate. Keep them consistent. Tasks with parents are excluded
  from top-level lists and shown under their parent instead.
- `PollingSource` owns freshness; TanStack polling/focus refetch is disabled.
  Incremental polls deliberately fetch changes **without the view filter**, so
  reconciliation sees tasks leaving the view. Periodic full fetches discover
  deletions and refresh sidebar counts. Preserve server-relative time windows.
- Task edits go through `updateTask` in `src/api/endpoints.ts`, using
  `POST /tasks/bulk` with named fields. **`POST /tasks/{id}` erases omitted fields;
  an empty bulk field list is unsafe too.** Pass a server-issued `Task`, because
  reminders and assignees must be echoed even when another field changes. Use
  `updateReminders` for reminder changes; do not invent a second patch path.
- Completion combines optimistic cache updates with a component-local pending
  overlay (`useCompleteTask` / `model/pending.ts`) to retain completed rows briefly
  for Undo. Recurring tasks advance rather than complete and do not offer Undo.
- Quick-add separates masking/orchestration, recurrence and sigils from
  chrono-node date resolution. A closed grammar admits chrono's candidates;
  language packs supply words, not complete phrase regexes. User overrides apply
  both to preview and submit. Golden corpus tests characterise behaviour: explain
  changed outputs before regenerating expectations.
- Dates use the browser timezone, also sent as `filter_timezone`. Vikunja has no
  all-day flag: date-only values use `default_due_time` (fallback `20:00`).
  `parseVikunjaDate` handles the server's year-one unset-date sentinel.

## Generated files and deployment

- `VERSION` is the version source of truth. After changing it, run
  `pnpm version:sync` to derive `package.json`; `pnpm version:check` checks drift.
  Vite embeds the same value as `__APP_VERSION__`.
- `src/theme/tokens.css` is the shipped design-token source. After editing it,
  run `pnpm design:sync`; the token block in `DESIGN.md` is generated, while its
  prose is authored. `pnpm design:check` checks drift.
- Deploy only `dist/` as static files. Vikunja must allow the SPA origin in
  `cors.origins`; an HTTPS SPA cannot call an HTTP API. See README's Deploy section.

## Specification pointers

- Before changing API mappings, priorities, all-day dates, recurrence or ordering,
  read the relevant section of `docs/data-model-mapping.md`.
- Before changing quick-add grammar, read that document's §5/§5.1 and the
  handover's D-parser, D-vocab and D-adverb decisions. The grammar is intentionally
  narrower than chrono-node's accepted input.
- Before changing layout, read `docs/layout-specs.md`; use shipped CSS tokens for
  implementation, `DESIGN.md` for design rules, and `research/` only as reference
  material, not product assets.

## Knowledge Bundle
Project knowledge lives in `knowledge/` as an Open Knowledge Format (OKF v0.2) bundle: `project/` (state, stack, setup, conventions), `architecture/`, `decisions/` (one concept per decision), `playbooks/` (one per recurring task). Search it with the model-invocable `okf-drift:okf-runtime` skill in recall mode with "<terms>" — never bare `okf search`: recall joins the search with `drift check` and WITHHOLDS any concept whose bound code has changed since it was written, naming the commit to blame. A withheld concept is a refusal, not a weaker hit: read the code it points at instead of quoting it. Before editing a specific file, `okf search --for-path <file>` (no drift join — check the hit's `last_updated` against `git log` before trusting it). The bundle has no code graph: use Grep, Glob and LSP for callers and source navigation. The format for a new playbook or decision is at the top of `knowledge/playbooks/index.md` and `knowledge/decisions/index.md` — search will not find it, read the index. The same pinned gate runs through a standalone bootstrap in CI (`.github/workflows/knowledge.yml`) on every PR and on push to `main`: a code change can make a concept stale without touching `knowledge/`, and a stale concept blocks the merge until it is re-stamped via `/okf-write`.

The runtime skill resolves its launcher from the skill directory supplied by the host and uses this repository's `.okf-drift-version`; no consumer scripts or saved plugin-cache paths are needed. If the skill is unavailable, stop and report the missing plugin; use the pinned bootstrap documented in okf-drift's README (the `pinned runtime gate` step in `.github/workflows/knowledge.yml`). Historical operational commands in `knowledge/` are non-authoritative: this section governs gate and recall. Preserve this project's required read order.

## Work Loop
1. **Context** — read `knowledge/project/state.md`; invoke the model-invocable `okf-drift:okf-runtime` skill in recall mode with "<terms>" for the concepts the task touches; check `knowledge/playbooks/index.md` for a matching playbook and follow it.
2. **Build** — if you deviate from a playbook or a convention, say so before writing code.
3. **Verify** — run the Verify Checklist in `knowledge/project/conventions.md` item by item before presenting code.
4. **Grow** — after meaningful work: update `state.md` if what works / is missing / is broken changed; fix any concept that is now wrong; write a decision or a playbook if one was made or one would have saved a wrong turn; run `drift link knowledge/<concept>.md <path>` for every new `code_refs` entry; when you reviewed a concept against a code change and it still holds, `drift link … --doc-is-still-accurate` **and** a dated line in `knowledge/log.md` saying what you checked against what — never re-stamp silently, and never re-stamp code you did not read; bump `last_updated` (and `stale_after` when you reviewed the concept) on what you touched; run `okf-drift:okf-runtime` in gate mode before committing.

## Navigation
At the start of every session, first follow the required `docs/HANDOVER.md` §0 read above, then read `knowledge/index.md` and `knowledge/project/state.md` before implementation.
