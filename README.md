# open-todo

A genuinely good UI for [Vikunja](https://vikunja.io), built by measuring what
Todoist's shipped interface does and reimplementing it natively.

**Status:** web app plus a minimal Tauri desktop shell. The same React + Vite
application talks to a self-hosted Vikunja directly from the browser or a
bundled macOS window: server setup, login, Inbox, Today and project lists,
polling, quick-add, task editing and completion are shared. The desktop slice
adds responsive navigation, persisted window geometry, single-instance
activation and guarded close/quit behavior; notifications, offline storage,
signing and public installers remain out of scope.

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
pnpm desktop:dev   # Tauri window + Vite
pnpm desktop:build # local desktop bundle
```

### Desktop development

The Tauri project is portable across desktop targets, with macOS as the first
verified target. Install Rust 1.88+ and the platform's native build tools
(Xcode Command Line Tools on macOS), then use:

```bash
pnpm desktop:dev   # starts Vite and opens the native window
pnpm desktop:build # runs the production web build, then bundles local assets
pnpm exec tauri info
```

A production desktop build does not need a running Vite server: Tauri loads the
bundled `dist/` files. Local macOS bundle output is under
`src-tauri/target/release/bundle/`. The first shell uses standard decorations,
restores size and position with Tauri's window-state plugin, and keeps one main
window when a second launch or Dock reopen occurs. Closing the macOS window
hides it while the process remains available; Command-Q quits. Unsaved task,
comment and setup drafts are guarded by the shared close/quit confirmation.

The native window uses a restricted CSP. It permits only bundled application
assets and explicitly configured HTTP/HTTPS API connections; it does not permit
arbitrary remote navigation. HTTP Vikunja instances require an origin-bound
confirmation before credentials are sent. Credentials remain in the app's
web-storage namespace, matching the web app's existing security trade-off; no
keychain migration or automatic session import is promised.

Public signing, notarization, installers, auto-update, notifications, tray or
background services, and Windows/Linux runtime validation are deferred.

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

A second integration test **writes**, and so needs a third variable on top of
those two — it cannot run by accident:

```bash
VIKUNJA_TEST_URL=https://vikunja.example \
VIKUNJA_TEST_TOKEN=tk_... \
VIKUNJA_TEST_WRITE=1 \
pnpm test src/api/integration.write.test.ts
```

It creates two scratch tasks in your default project, completes and reopens
them, and deletes them at the end. What it is checking is that completing a
task does not erase the rest of it, and that a repeating task is advanced
rather than completed — see `D-write` in `docs/HANDOVER.md` for why that is
not a given.

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
| `src/ui` | Components at the geometry in `docs/layout-specs.md`, including responsive layouts |
| `src-tauri` | Cross-platform Tauri shell, window lifecycle and native packaging metadata |
| `DESIGN.md` | The design system: tokens (generated), layout rules, components, do's and don'ts |
| `docs/` | The specification: layout measurements, data-model mapping, handover |
| `research/` | Reference material captured from Todoist; not shipped |

## Licence

[MIT](LICENSE). © 2026 Alessandro Viganò.

open-todo carries no Todoist code, assets or trade dress, and no code from
Vikunja itself: Vikunja is AGPL-3.0-or-later, and reusing its source — its
quick-add parser, for instance — would place open-todo under that licence too.
open-todo speaks to Vikunja over its public HTTP API only.
