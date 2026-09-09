# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Foundation slice**: a static React + Vite SPA that talks to a self-hosted
  Vikunja directly from the browser, with no proxy.
  - Server setup and login: probes `/info` and shows the server version, then
    accepts either username/password (with an authenticator field when the
    server asks) or a pasted API token. Logging out clears the credential and
    keeps the server URL.
  - Vikunja API client: typed errors, pagination, and the filter builders for
    the forms verified in `docs/data-model-mapping.md` §6.
  - Read-only Inbox, Today and project views at the layout measured in
    `docs/layout-specs.md`, with hash routing and sidebar counts.
  - Live refresh (D6): `PollingSource` behind a `LiveSource` interface — a
    20-second incremental poll while the tab is visible, a full fetch every
    fifth tick to catch deletions, and an immediate refresh on focus.
  - Theme tokens in light and dark with open-todo's teal accent (D3), an
    original icon set, and a theme toggle that respects the system setting.
- `DESIGN.md` — the design system in the open DESIGN.md format (tokens in front
  matter, the eight canonical sections, Motion and a Decisions Log), so gstack's
  design skills and impeccable read the same file. Its token block is generated
  from `src/theme/tokens.css` by `scripts/sync-design-tokens.mjs` and `pnpm
  check` fails on drift, so the design doc cannot quietly disagree with the
  shipped stylesheet.
- `VERSION` is the single source of truth: `scripts/sync-version.mjs` derives
  `package.json` from it and the build fails on drift.
- Handover document (`docs/HANDOVER.md`) stating the project's purpose, the
  findings of the Todoist reconnaissance pass, the open decisions, and the
  legal boundaries on reuse.
- `CLAUDE.md` and a "read this first" section in the handover, so a session
  started cold from this repo knows what is decided, what is open, and how the
  owner wants decisions presented.
- `research/todoist-tokens-light.json` and `research/todoist-tokens-dark.json` —
  CSS custom properties captured from the live Todoist web app, as reference
  material for deriving an original palette.
- `docs/layout-specs.md` — numeric layout specification measured from the live
  product, plus `research/measure-dom.js` to reproduce it.
- `docs/data-model-mapping.md` — the Todoist to Vikunja mapping, the priority
  and all-day conventions, and the refresh strategy.

### Fixed
- The page walk ended on the `x-pagination-total-pages` header, which a
  cross-origin browser cannot read unless the instance sends
  `Access-Control-Expose-Headers` — measured, and the deployment model is
  cross-origin by design. Every collection silently truncated to 50 items, and
  a truncated *full* fetch made the polling diff report the missing tasks as
  deletions. The walk now ends on a short page and is correct either way.
- The incremental poll mark was the browser's clock compared against the
  server's `updated`, so a clock even a minute fast killed incremental
  refresh outright and silently. It is now derived from server timestamps.
- A `refreshNow()` arriving while a tick was in flight was dropped; it is now
  queued. A failed full fetch lost its turn in the cadence, delaying deletion
  detection; it is now retried.
- A 401 from an anonymous request (`/info`, `/login`) cleared the stored
  credential, which behind an authenticating proxy would log the user out for
  an unrelated reason.
- A scoped API token that may read tasks but not `/user` was rejected at login,
  contradicting the query layer, which already tolerates `/user` failing.
- Tasks merged in by the poll were appended rather than sorted, so a task
  created or rescheduled elsewhere sat at the bottom of the list.
- Sidebar Inbox and Today counts never refetched while another view was open.
- `stop()` discarded subscribers, leaving a later `start()` deaf.

### Decided
- D1 (platform): open-todo is a **web app** in this repository, targeting
  self-hosted Vikunja. Apple platforms stay with Veyrn (`Vikunja-Tasks`).
- D3 (brand): own accent — teal — and an original icon set; the name stays.
- D4: interaction slices in the order quick-add, keyboard, drag reorder, undo.
- D5 (stack): React + Vite static SPA calling Vikunja directly. No proxy.
- D6 (refresh): poll behind a `LiveSource` interface; an upstream PR for
  WebSocket task events runs in parallel, off the critical path.

### Known gaps
- Read-only: no task creation, editing, completion or reordering yet. The
  checkboxes render priority but do not toggle.
- The TOTP error shape has not been seen against a real TOTP-enabled account;
  detection matches Vikunja's error code 1017 and the message text, and
  degrades to "wrong username or password" rather than to a stuck prompt.
- No token refresh: Vikunja 2.5.0 offers none, so an expired JWT returns the
  user to the login screen.
- UI strings and dates are English only; `UI_LOCALE` is the single place i18n
  will change.
- `GET /tasks` returns `position = 0`, so ordering is by due date. The drag
  slice will move to the view-scoped endpoint (`docs/data-model-mapping.md` §3).
- Deletions are found by reconciling the id set of a full fetch, because
  `deleted_at` is not filterable; a deletion can take up to five poll
  intervals to appear.
- The subtask "0 / N" badge relies on `related_tasks.subtask[]` carrying
  `done`: every view filters `done = false`, so a completed child is never in
  the listing. If the relation omits it, the badge under-reports as 0/N. The
  integration test reports the answer against a real server.
- `filter_timezone` and `filter_include_nulls` are sent but were not part of
  the verified filter set; if the server ignores the former, Today's boundary
  becomes the server's midnight rather than the user's.
- The incremental poll compares a mark against the server's `updated`. It is
  now derived from server timestamps, but a browser clock more than the
  bootstrap lookback ahead can still widen the first window on an empty view.
  A server-evaluated `updated >= now-30s` would remove the browser clock
  entirely and is the next thing worth verifying.
- Not yet exercised against a live Vikunja instance by the author of this
  slice — verified against a stand-in server implementing the same API, plus
  the read-only integration test that runs on demand.
