---
type: Decision
title: "Direct browser API"
description: "A static React SPA calls Vikunja directly; no proxy or SSR. Load before changing hosting, authentication custody or the application boundary."
status: stable
date: 2026-09-09
tags:
- architecture
- proxy
- cors
- hosting
- authentication
- license
sources:
- resource: docs/HANDOVER.md
- resource: README.md
- resource: LICENSE
code_refs:
- src/api/http.ts
- src/auth/authStore.ts
- vite.config.ts
last_updated: 2026-09-16
---

# Direct browser API

## Context
D1 targeted self-hosting users on the web. D5 initially chose a proxy after a foreign-origin probe was mistaken for globally disabled CORS.

## Decision
D5 was revised in commit `9d2faa1`: React + Vite ships static files and the browser calls the configured Vikunja API. The credential lives in localStorage. No proxy is on the current roadmap.

## Reasoning
Authenticated task pages gain little from SSR. React supplies the ecosystem for planned drag/virtualisation work; a configured CORS origin removes the supposed need for an intermediate server.

## Alternatives considered
Proxy custody would add a runtime; Svelte was viable but weaker for the planned interaction libraries; Next.js would add unused SSR. Republishing Todoist with a Sync API shim was rejected for legal, telemetry and maintenance reasons.

## Consequences
Operators must configure CORS and HTTPS. JWT expiry returns to login. MIT code uses public HTTP APIs: neither Todoist assets/code nor Vikunja AGPL source may be copied.

## Related
- [Architecture](/architecture/architecture.md) — the browser-to-server flow
- [Setup](/project/setup.md) — operator requirements
