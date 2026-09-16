---
type: Playbook
title: "Debug a Vikunja connection"
description: "Diagnose CORS network errors, login failures and stale or truncated task lists without adding a proxy or assuming pagination headers are readable."
tags:
- debug
- cors
- network
- login
- pagination
- refresh
sources:
- resource: README.md
- resource: docs/data-model-mapping.md
- resource: src/live/useLiveSource.ts
- resource: src/api/integration.test.ts
code_refs:
- src/api/http.ts
- src/api/http.test.ts
- src/api/endpoints.test.ts
- src/live/PollingSource.test.ts
- src/screens/SetupScreen.tsx
last_updated: 2026-09-16
---

# Debug a Vikunja connection

## Context
Browser fetch uses the same failure path for CORS, offline and DNS. Cross-origin headers can be invisible even while a request succeeds.

## Steps
1. Check the configured instance URL and page/API schemes; the client targets /api/v1 and GET /tasks, not /tasks/all.
2. Probe `/api/v1/info` without a credential and inspect the browser network failure. Ask the instance operator to verify the actual SPA origin in cors.origins; do not change custody architecture to mask configuration.
3. Distinguish an anonymous /info or /login 401 from an authenticated 401, which clears the stored credential. Never print a token while inspecting requests.
4. If lists stop at 50, inspect the page walk: short pages terminate, hidden total-pages headers must not. If departures take a full cadence, ensure incremental filters contain only the updated window.
5. Run `pnpm test src/api/http.test.ts src/api/endpoints.test.ts src/live/PollingSource.test.ts`. For an authorised live read-only check, use the separate integration command in CLAUDE.md; leave the write flag unset. No live server call or timing measurement was made during setup.

## Gotchas
The client message begins `Could not reach` and mentions `cors.origins`; it is diagnostic guidance, not proof of a CORS cause. `No Vikunja server configured.` means no base URL. `Refusing to read more than 200 pages` indicates a possibly ignored page parameter, not permission to return truncated data.

## Verify
HTTP tests must preserve anonymous-401 credentials and clear them only for authenticated rejection. Pagination tests must retrieve more than one full page with headers absent. Polling tests must cover forced refresh during an in-flight request and failed full-fetch retry.

## Debug
HTTPS page plus HTTP API → mixed-content block. /tasks/all 400 → obsolete route. Sidebar counts frozen → missing reset invalidation. Deletions later than updates → expected full-fetch reconciliation unless retries/lifecycle are broken.

## Related
- [Setup](/project/setup.md) — configuration and environment
- [Polling behind LiveSource](/decisions/polling-live-source.md) — freshness constraints
