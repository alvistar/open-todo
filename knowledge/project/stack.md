---
type: Reference
title: "Stack"
description: "Languages, frameworks, key libraries, what is deliberately not used, and version constraints. Load when working with a specific technology."
tags:
- stack
- dependencies
- react
- vite
- typescript
- versions
sources:
- resource: package.json
- resource: pnpm-lock.yaml
- resource: README.md
- resource: docs/HANDOVER.md
code_refs:
- package.json
- pnpm-lock.yaml
- vite.config.ts
last_updated: 2026-09-17
stale_after: 2026-12-17
---

# Stack

## Core Technologies
TypeScript 7, React/React DOM 19 and Vite 8 build a static browser application. Tauri 2.11.3 packages the same Vite output as a portable desktop shell; macOS is the first verified target. pnpm owns the web lockfile and Cargo owns `src-tauri/Cargo.lock`. CSS Modules style components; semantic CSS custom properties and a system-font stack supply the theme. The project is MIT-licensed and the package is private, not an npm release target.

## Key Libraries
TanStack Query 5 holds remote state and mutation invalidations. chrono-node **2.10.1** resolves dates behind the application's closed grammar. Tauri's official window-state 2.4.1, single-instance 2.3.4 and dialog 2.4.1 plugins provide the native geometry, process ownership and recovery primitives. Vitest 5, jsdom 30 and Testing Library cover pure logic and DOM behaviour; Biome 2 formats and lints. Read [the parser boundary](/architecture/quick-add.md) before replacing a parser dependency.

## What We Deliberately Do NOT Use
There is no application server, SSR runtime, proxy, local database, offline outbox or hosted parsing service. `dnd-kit` and virtualisation are rationale for choosing React, not installed features. No Todoist assets or Vikunja source are vendored.

## Version Constraints
The manifest uses ranges except for chrono-node and the Tauri npm bindings' exact pins. The lock resolves React 19.2.8, TanStack Query 5.102.8, Vite 8.2.2, TypeScript 7.0.2, Vitest 5.0.0, jsdom 30.0.1, Tauri API 2.11.1, CLI 2.11.4 and window-state bindings 2.4.1. Use Node 22.22.2+, 24.15.0+, or 26+ within those respective major lines: jsdom's engine range is stricter than Vite's. Native builds use the committed Tauri 2.11.3 graph and require Rust 1.88+ plus the platform's native tools. The repo does not pin a pnpm version. `VERSION` derives package metadata and the embedded app version; changing package.json alone is incorrect. The knowledge tooling is separately pinned to okf v0.3.0, drift v0.10.1 and okf-drift v0.5.1.

## Related
- [Direct browser API](/decisions/direct-browser-api.md) — why a static SPA, rather than a proxy or SSR
- [Conventions](/project/conventions.md) — how these tools are used
- [Setup](/project/setup.md) — runtime prerequisites and local configuration
