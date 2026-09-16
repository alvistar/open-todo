---
type: Reference
title: "Setup"
description: "Prerequisites, first-time setup, environment variables, and the issues that actually occur. Load when setting up the project or when the environment misbehaves."
tags:
- setup
- installation
- environment
- login
- cors
- deployment
sources:
- resource: README.md
- resource: package.json
- resource: pnpm-lock.yaml
- resource: src/api/http.ts
code_refs:
- src/screens/SetupScreen.tsx
- src/settings/settingsStore.ts
- src/auth/authStore.ts
- scripts/sync-version.mjs
last_updated: 2026-09-16
stale_after: 2027-03-16
---

# Setup

## Prerequisites
Install pnpm and a Node version satisfying the locked toolchain (see Stack). A reachable Vikunja instance is needed to use the app, not for the default unit tests. For knowledge validation, install okf v0.3.0 and drift v0.10.1; the repository wrappers also need Python 3, curl and git. The first wrapper invocation needs network access to fetch its pinned script.

## First-time Setup
1. Clone the repository and use the install and development-server commands in [CLAUDE.md](<../../CLAUDE.md>); that is the daily command reference.
2. Open the Vite URL (normally localhost port 5173). Enter the instance root; the HTTP layer normalises a pasted API suffix.
3. The setup screen probes `/api/v1/info`, then accepts password/TOTP or an API token. Configuration is browser-local, not a checked-in environment file.
4. For hosting, follow [README](<../../README.md>)'s Deploy section: serve only `dist/`, allow the SPA origin in Vikunja CORS, and use compatible HTTPS schemes. Hash routing requires no server rewrite rule.

## Environment Variables
- `VIKUNJA_TEST_URL` — conditional, instance location for opt-in live API tests.
- `VIKUNJA_TEST_TOKEN` — conditional, credential for those tests; never commit or print it.
- `VIKUNJA_TEST_WRITE` — conditional, must equal `1` to enable tests that create/mutate/delete scratch tasks. Do not set it for read-only verification.
- No application environment variables are required for first-run server selection. URL and credential are stored under `open-todo.baseUrl` and `open-todo.token` in localStorage.

## Common Issues
A cross-origin fetch failure can be CORS, DNS, offline or mixed content; use the connection playbook instead of assuming the server is down. A JWT expiry returns to setup because there is no refresh API in the verified server version. A missing `node_modules` means app tests and the build need the documented dependency installation first; it does not prevent the standalone version/design checks. Never interpret README's old read-only status as a current feature inventory.

## Related
- [Stack](/project/stack.md) — compatible runtime versions
- [Debug a connection](/playbooks/debug-vikunja-connection.md) — distinguish network, CORS and credential failures
