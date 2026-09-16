---
type: Playbook
title: "Change shipped design tokens"
description: "Change CSS tokens and regenerate DESIGN.md while preserving measured geometry, theme overrides and the original brand boundary."
tags:
- design
- tokens
- theme
- css
- generated
- geometry
sources:
- resource: DESIGN.md
- resource: docs/layout-specs.md
- resource: docs/HANDOVER.md
- resource: README.md
code_refs:
- src/theme/tokens.css
- scripts/sync-design-tokens.mjs
- src/theme/theme.test.ts
last_updated: 2026-09-16
---

# Change shipped design tokens

## Context
DESIGN.md mixes generated token data with authored guidance. Editing its generated block or reading old reference colours as product tokens creates drift.

## Steps
1. Read shipped src/theme/tokens.css and the relevant layout-spec section; use the original icon paths, not copied reference assets.
2. Change semantic tokens in CSS. Preserve bare-root light values, system-dark overrides guarded against explicit light, and explicit-dark overrides.
3. Run `pnpm design:sync`, review only the intended generated change, then `pnpm design:check`.
4. Run `pnpm test src/theme/theme.test.ts` and applicable UI tests, then check geometry and contrast in both themes for an interaction change. The sync/check mechanism was validated during setup on 2026-09-16; browser timing and UI tests were not rerun.

## Gotchas
The unresolved non-accent palette question in DESIGN.md is an owner decision, not permission to import reference CSS. Row metadata has fixed height even when empty; dropping it previously collapsed rows. The toolbar must not shrink under a long task list.

## Verify
design:check must reject mismatched generated token metadata. Theme tests verify complete overrides rather than a single screenshot. Compare real row height, toolbar height and hit targets against the measured specification after layout edits.

## Debug
Generated-token drift → edit CSS then sync, not the generated block. Dark toggle loses to OS setting → inspect the guarded media query and explicit data-theme selector. Row height changes with empty metadata → preserve the reserved metadata line.

## Related
- [Distinct brand](/decisions/distinct-brand.md) — the settled identity and remaining palette question
- [Conventions](/project/conventions.md) — review checklist and generated sources
