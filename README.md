# open-todo

A genuinely good UI for [Vikunja](https://vikunja.io), built by measuring what
Todoist's shipped interface does and reimplementing it natively.

**Status:** foundation slice. A static React + Vite SPA that talks to a
self-hosted Vikunja directly from the browser: server setup, login, and
read-only Inbox, Today and project lists at the measured layout, kept fresh by
polling. Creating and editing tasks is not built yet — that is the next slice.

Start here: [`docs/HANDOVER.md`](docs/HANDOVER.md) — purpose, findings from the
Todoist reconnaissance pass, decisions taken and still open, and legal
boundaries. If you are an agent picking this up cold, begin at its §0.

No Todoist code, bundles, icons, fonts, or logos are contained in or vendored
into this repository. See §6 of the handover.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # biome + tsc
pnpm test       # vitest
pnpm build      # -> dist/
```

`DESIGN.md` is the design system, in the open DESIGN.md format that gstack's
design skills and impeccable read. Its front matter is **generated** from
`src/theme/tokens.css` by `scripts/sync-design-tokens.mjs`; `pnpm check` fails
on drift. Edit the CSS and run `pnpm design:sync` — never hand-edit the token
block. The prose sections are authored.

`VERSION` at the repo root is the single source of truth for the version:
`package.json` is derived from it by `scripts/sync-version.mjs`, the build
fails on drift, and the bundle reads the same file. Never edit the version in
`package.json`.

There is no server-side component, so `pnpm dev` talks to your Vikunja
instance directly. Vikunja's default `cors.origins` already includes
`http://localhost:*`, so development needs no server change.

### Testing against a real instance

The unit tests need no server. There is also a read-only integration test,
skipped unless both variables are set:

```bash
VIKUNJA_TEST_URL=https://vikunja.example \
VIKUNJA_TEST_TOKEN=tk_... \
pnpm test src/api/integration.test.ts
```

It only reads: it checks `/info`, the user's default project, and that the
filter forms this app relies on are still accepted.

## Deploy

`pnpm build` produces `dist/`, a folder of static files. Serve it from any web
server — Caddy, nginx, GitHub Pages, `python3 -m http.server`. There is nothing
to run alongside it.

**The one server-side requirement:** the browser calls Vikunja's API directly,
so Vikunja must allow this app's origin. Add it to `cors.origins` in Vikunja's
config:

```yaml
cors:
  origins:
    - https://todo.example
```

or set `VIKUNJA_CORS_ORIGINS=https://todo.example`. Without it every request
fails, and the browser reports it as a generic network error — the setup
screen names CORS as a likely cause for exactly this reason.

Two more things worth knowing before you deploy it:

- **Serve open-todo over the same scheme as Vikunja.** A page served over
  HTTPS cannot call an HTTP API; browsers block the mixed content.
- **The credential lives in `localStorage`**, which is what Vikunja's own
  frontend does. Vikunja 2.5.0 has no token refresh, so when the JWT expires
  the app returns to the login screen. A long-lived API token avoids that.

## What is here

| Area | Notes |
|---|---|
| `src/api` | Vikunja client: HTTP, typed errors, endpoints, filter builders |
| `src/model` | The conventions — priority (D-map-1), all-day dates (D-map-2), view definitions, grouping |
| `src/live` | `LiveSource` and the polling implementation (D6) |
| `src/ui` | Components at the geometry in `docs/layout-specs.md` |
| `DESIGN.md` | The design system: tokens (generated), layout rules, components, do's and don'ts |
| `docs/` | The specification: layout measurements, data-model mapping, handover |
| `research/` | Reference material captured from Todoist; not shipped |

## Licence

[MIT](LICENSE). © 2026 Alessandro Viganò.

open-todo carries no Todoist code, assets or trade dress, and no code from
Vikunja itself: Vikunja is AGPL-3.0-or-later, and reusing its source — its
quick-add parser, for instance — would place open-todo under that licence too.
open-todo speaks to Vikunja over its public HTTP API only.
