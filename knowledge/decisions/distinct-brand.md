---
type: Decision
title: "Distinct brand and original assets"
description: "Teal accent and original icons distinguish open-todo from the measured reference. Load when changing visual identity or importing assets."
status: stable
date: 2026-09-09
tags:
- branding
- teal
- icons
- assets
- design
- license
sources:
- resource: docs/HANDOVER.md
- resource: docs/layout-specs.md
- resource: DESIGN.md
- resource: THIRD_PARTY_NOTICES.md
code_refs:
- src/theme/tokens.css
- src/ui/icons/paths.ts
last_updated: 2026-09-17
stale_after: 2026-12-17
---

# Distinct brand and original assets

## Context
The product reimplements observed behaviour, not proprietary source. A generic todo name plus the reference product's red identity would blur that boundary.

## Decision
D3 chose original icons and a teal accent (`c42f02f`, hue settled by `c1e0b92`). Keep open-todo as the name; use system fonts and independently authored assets.

## Reasoning
Teal avoids priority/date colour collisions. Indigo conflicted with blue/purple meanings and burnt orange with urgency/tomorrow while remaining reference-adjacent.

## Alternatives considered
Reusing red or leaving a temporary unbranded placeholder would preserve the wrong identity and require later redesign. Asset copying is prohibited, not an implementation shortcut.

## Consequences
Measured geometry can guide implementation. The shipped glyphs remain independently authored geometric path data on a 24×24 grid. Shipped CSS is authoritative for token values; DESIGN.md still flags the unresolved non-accent palette question, so this decision must not be read as settling it.

## Related
- [Conventions](/project/conventions.md) — semantic token and asset rules
- [Change design tokens](/playbooks/change-design-tokens.md) — keep generated documentation aligned
