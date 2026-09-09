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

### Verified against a live Vikunja 2.5.0 (2026-09-09)
- `updated >= now-30s` is accepted, so the incremental poll window is now
  evaluated by the server and the browser clock is out of the loop entirely.
- `filter_timezone` is honoured (13 tasks for `Europe/Rome` against 15 for
  `Pacific/Auckland` on the same filter).
- Subtask relations carry a boolean `done`, so the "0 / N" badge is correct;
  `related_tasks` was present on all 49 open tasks without `expand`.
- The instance exposes the pagination headers, so the truncation bug fixed
  below was latent there rather than active — it remains real for any instance
  that does not send `Access-Control-Expose-Headers`.
- `frontend_settings.default_due_time` is absent on 2.5.0, so D-map-2's 20:00
  fallback is the live behaviour.
- The rendered app was driven against the live instance: geometry matches the
  spec with real content (toolbar 56, title tier 84, rows 59 and 79, sidebar
  280, column 800, no horizontal overflow), the incremental poll really does
  send `updated >= now-<n>s` with the browser's timezone, D-map-1 maps a stored
  priority of 3 to P2 on screen, and a task created externally appeared within
  one 20s interval, sorted into its place by due date, while a deletion cleared
  within ~40s on the next full fetch.

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
- Times were rendered in Vikunja's `settings.timezone`, which on the reference
  instance is an untouched `GMT` while the user is in Italy — every displayed
  time would have been an hour or two out, and filtering in one zone while
  labelling in another can show a task under "Today" that reads as tomorrow.
  The browser's zone is now used for both.

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
- Read-only still: no task creation, editing, completion or reordering. The
  checkboxes render priority but do not toggle.
