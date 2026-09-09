---
# gstack: design-md-format=spec
# GENERATED from src/theme/tokens.css by scripts/sync-design-tokens.mjs.
# Do not hand-edit this block: run `pnpm design:sync`. Prose below is authored.
name: open-todo
typography:
  display:
    fontFamily: -apple-system, system-ui, "Segoe UI", "Noto Sans", sans-serif
  body:
    fontFamily: -apple-system, system-ui, "Segoe UI", "Noto Sans", sans-serif
    fontSize: 13px
  label:
    fontFamily: -apple-system, system-ui, "Segoe UI", "Noto Sans", sans-serif
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
colors:
  bg-primary-light: "#fff"
  bg-primary-dark: "#1f1f1f"
  bg-secondary-light: "#fcfaf8"
  bg-secondary-dark: "#262626"
  text-primary-light: "#202020"
  text-primary-dark: "#fff"
  text-secondary-light: "#666"
  text-secondary-dark: "#ccc"
  text-tertiary-light: "#aaa"
  text-tertiary-dark: "#8a8a8a"
  text-on-secondary-button-light: "#444"
  text-on-secondary-button-dark: "#e4e4e4"
  divider-light: "#eee"
  divider-dark: "#3d3d3d"
  divider-faint-light: "#f5f5f5"
  divider-faint-dark: "#282828"
  border-idle-light: "#e6e6e6"
  border-idle-dark: "#3d3d3d"
  border-focus-light: "#b8b8b8"
  border-focus-dark: "#707070"
  accent-light: "#0f766e"
  accent-dark: "#2dd4bf"
  on-accent-light: "#fff"
  on-accent-dark: "#062a26"
  accent-secondary-fill-light: "#d1ebe7"
  accent-secondary-fill-dark: "#1f4a44"
  selected-fill-light: "#e1f0ed"
  selected-fill-dark: "#233f3b"
  selected-text-light: "#0b5c56"
  selected-text-dark: "#8ee6da"
  priority-p1-light: "#d1453b"
  priority-p1-dark: "#ff7066"
  priority-p2-light: "#eb8909"
  priority-p2-dark: "#ff9a13"
  priority-p3-light: "#246fe0"
  priority-p3-dark: "#5297ff"
  priority-p4-light: "#999"
  priority-p4-dark: "#a9a9a9"
  schedule-overdue-light: "#d1453b"
  schedule-overdue-dark: "#ff7066"
  schedule-today-light: "#058527"
  schedule-today-dark: "#25b84c"
  schedule-tomorrow-light: "#ad6200"
  schedule-tomorrow-dark: "#ff9a14"
  schedule-next-week-light: "#692ec2"
  schedule-next-week-dark: "#a970ff"
  hover-fill-light: "rgba(0, 0, 0, 0.04)"
  hover-fill-dark: "rgba(255, 255, 255, 0.06)"
  overlay-light: "rgba(0, 0, 0, 0.4)"
spacing:
  hairline: 1px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  2xl: 30px
  gutter: 55px
rounded:
  base: 5px
  card: 10px
  composer: 12px
  chip: 8px
---

# Design System — open-todo

## Overview

- **What this is:** a genuinely good UI for [Vikunja](https://vikunja.io) — a
  static SPA that talks to a self-hosted instance directly from the browser.
- **Who it's for:** people who self-host Vikunja and want its interface to feel
  like a product rather than an admin panel. Single-user instances first.
- **Space/industry:** personal task managers (peers: Todoist, Things, TickTick).
- **Project type:** application behind a login. No marketing surface, no SEO.

- **Direction:** quiet and typographic. The list is the product; chrome recedes.
  Density comes from a tight type scale and generous line height, not from
  small text or hairline borders everywhere.
- **Decoration level:** minimal. No gradients, no shadows except modals, no
  illustration. Colour is reserved for meaning — priority and time.
- **Mood:** calm, fast, unremarkable in the way a good tool is. Nothing on the
  screen competes with the user's own words.

**Where these values come from.** This is a reimplementation, not a port.
Todoist's shipped interface was measured (`docs/layout-specs.md`) and the
measurements are treated as specification. The **accent is our own** — teal, per
HANDOVER D3 — and so are the icons and the name. No Todoist code, bundle, icon,
font or logo is in this repository (HANDOVER §6).

> **Open:** whether the measured *non-accent* values (neutrals, priority and
> schedule hues) may ship verbatim is unresolved — HANDOVER §6 says both yes
> ("treat measured values as specification") and no ("not something to ship
> verbatim as the product's theme"). Recorded in the Decisions Log; the tokens
> below are the current state, not a settled answer.

## Colors

Every colour is a semantic role, never a raw hex at the point of use. The front
matter is generated from `src/theme/tokens.css`, which is the source of truth.

| Role | Purpose |
|---|---|
| `bg-primary` / `bg-secondary` | page ground; sidebar and modal sidebars |
| `text-primary` / `secondary` / `tertiary` | task titles; descriptions and labels; counts |
| `divider` / `divider-faint` | row separators; subtask rules |
| `border-idle` / `border-focus` | inputs and chips at rest; focused composer |
| `accent` / `on-accent` | primary actions, links, active nav counts |
| `accent-secondary-fill` | quick-add natural-language match highlight |
| `selected-fill` / `selected-text` | the active sidebar row |
| `priority-p1…p4` | task priority, per D-map-1 |
| `schedule-overdue / today / tomorrow / next-week` | due-date urgency |

**Two rules that matter more than the values.**

1. **Colour carries meaning, or it is not used.** The eight priority and
   schedule colours are the only hues in the product besides the accent. Adding
   a ninth meaning-bearing colour needs a decision here first — the teal accent
   was chosen specifically because it collides with none of them.
2. **Light and dark are equal citizens.** Light is defined on bare `:root`;
   dark is redefined twice — under `prefers-color-scheme` guarded by
   `:not([data-theme="light"])`, and under `[data-theme="dark"]` — so an
   explicit choice always beats the system in both directions. No colour may
   have its only definition inside a media query.

## Typography

One system stack, no webfont: `-apple-system, system-ui, "Segoe UI",
"Noto Sans", sans-serif`. A task manager is read in glances; a font that is
already resident beats one that is beautiful.

| Use | Size / line-height / weight |
|---|---|
| View title (`h1`) | 26 / 35 / 700 |
| Section header (`h2`) | 14 / 21 / 700 |
| Task title | 14 / 21 / 400 |
| Sidebar nav label | 14 / 16 / 400 (600 when selected) |
| Task description, row metadata | 12 / 18 / 400 |
| Counts, chips | 12 / 16–24 / 400 |
| Base / body | 13 |

Only four sizes carry the whole product: 26, 14, 13, 12. Reach for weight or
colour before reaching for a fifth size.

## Layout

Measured at a 1639×878 viewport (`docs/layout-specs.md` §1–§2).

```
┌──────────────┬──────────────────────────────────────────────┐
│ sidebar 280  │ toolbar 56, sticky                           │
│ (content 256,│──────────────────────────────────────────────│
│  12px inset) │        content column 800, centred           │
│              │        title tier 52 — or 84 with subtitle   │
│  nav rows 34 │        ┌─ section header, bled 16px each side│
│              │        │  task row 79 (with description)     │
│              │        │  task row 59 (title only)           │
└──────────────┴──────────────────────────────────────────────┘
```

- **Content column is 800px, centred** in the remaining width, inside a scroll
  container padded `0 55px 84px`.
- **Row heights are exact, not approximate**: 8 pad + 23 title + 3 + 16 meta +
  8 pad + 1 border = 59; a one-line description adds 18 + 2 = 79. The metadata
  row keeps its height even when empty, so rows in a list share one rhythm.
- **The row hit area bleeds 8px each side** (816 wide) so hover and focus
  extend past the text, while the content still starts at the column edge.
- **Hit targets:** 32×32 for icon buttons, 28×28 secondary, 34px nav rows.

### Spacing

The scale is 4 / 8 / 12 / 16 / 22 / 30, plus a 55px page gutter and the 12px
sidebar inset. 22 and 30 are not arbitrary: 22 is the task row's right margin
(the project chip bleeds back over it) and 30 is the gap between list sections.

## Elevation & Depth

Almost none, deliberately. The product is one plane.

- **Surfaces** separate by colour, not shadow: the sidebar is `bg-secondary`
  against a `bg-primary` page, with no border and no shadow between them.
- **The only shadow in the product** is the modal: `0 2px 8px rgba(0,0,0,.16)`
  over a `rgba(0,0,0,.4)` overlay.
- **Stickiness replaces elevation.** The toolbar, section headers and the
  sidebar's group header stay put while content moves under them; each paints
  its own background so text never shows through.

## Shapes

| Radius | Used for |
|---|---|
| 5px | the default — buttons, nav rows, task rows, hit areas |
| 8px | chips and small composer buttons |
| 10px | cards and modals |
| 12px | the quick-add composer |
| 50% | the priority checkbox and avatars |

Nothing is a rectangle by accident: 5px is the resting state of the whole UI,
and a larger radius signals a larger, more separate thing.

## Components

- **Task row.** Priority checkbox (24×24, an 18px circle with a 2px border in
  the priority colour), then title, optional one-line description, then a
  metadata row: subtask count, due date in its schedule colour, reminder,
  comment count, and the project chip pushed right. Truncate; never wrap.
- **Priority checkbox.** The only place priority is expressed in a list. p1–p3
  carry a tinted fill, p4 stays neutral. Hover previews the check at 55%.
- **Sidebar nav row.** 34px, icon 24 + label + a 24px count cell. Inbox and
  Today counts take the accent; project counts stay tertiary. The selected row
  is a filled pill, not a left border.
- **View header.** Two tiers — a sticky 56px toolbar, then the title inside the
  content column so the heading aligns with the tasks, not with the window.
- **Section header.** Sticky, bled 16px each side of the column, `700`. The
  first section sits flush; later ones get 30px above.
- **Setup / login card.** The one place with a card and a shadow, because it is
  the one screen with no list behind it.

### Icons

Our own set (D3): 18 glyphs built from geometric primitives on a 24×24 grid,
stroked at 1.6, rendered at 24 (nav), 16 (chips) and 12 (row metadata). Stroke,
not fill, except for deliberate dots. No traced paths from anywhere.

## Do's and Don'ts

**Do**

- Put colour where there is meaning — priority, time, the active row.
- Keep the list the loudest thing on the screen.
- Give every control a real hit target (32×32 minimum) even when the glyph is
  12px.
- Make dark a first-class design, not an inversion: pick dark values, don't
  compute them.
- State geometry in the stylesheet as the measured number, with the spec's
  arithmetic in a comment, so a later change can tell intent from accident.

**Don't**

- Don't add a hue that means nothing. Decoration in this product reads as a
  status the user then hunts for.
- Don't reproduce Todoist's upsell rows, its team/QR promos, or its empty
  1157px toolbar cell — those are `docs/layout-specs.md` §6 "do not copy".
- Don't use Todoist's accent family (`#d33322`, `#d04348`, `#dc4c3e`) anywhere.
- Don't ship a shadow outside a modal, or a gradient at all.
- Don't hide a row's metadata line to save space — it breaks the shared rhythm
  and was a real bug (rows collapsed 59 → 40).
- Don't read tokens from this file when writing a mockup. Read
  `src/theme/tokens.css`; this file is generated from it.

## Motion

Sparing and short. The only transition in the product today is the priority
checkbox's fill at 80ms linear. Anything added should stay under 120ms and be
a property that does not reflow (opacity, background, transform). No entrance
animations on lists: tasks appear because the server said so, and a stagger
makes a poll look like a page load.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-09 | Accent is teal — `#0f766e` light, `#2dd4bf` dark | D3. Collides with none of the eight priority/date colours; WCAG AA on filled buttons in both themes (5.5:1 light, 8.3:1 dark). Chosen over indigo (collides with p3 and next-week) and burnt orange (collides with p2 and tomorrow, and reads Todoist-adjacent). |
| 2026-09-09 | Own icon set, name stays `open-todo` | D3. The name is generic, so the accent and icons carry the distance from Todoist's trade dress. |
| 2026-09-09 | Dark `text-tertiary` is `#8a8a8a` | Resolves `docs/layout-specs.md` §0 footnote 1: the measured dark token there is a fill, not a text colour, and was unusable as one. |
| 2026-09-09 | Geometry is the measured value, verified in a browser | Row heights, column width and hit areas are checked against the spec at 1639×878 rather than eyeballed. Caught two real defects: a 2px margin-collapse and a 40px collapsed row. |
| 2026-09-09 | English-only strings and dates, via one `UI_LOCALE` | A localised weekday beside a hard-coded English "Today" shipped as "9 set · Today · mercoledì". Until i18n exists, one locale, in one place. |
| — | **Open: may the measured non-accent values ship verbatim?** | HANDOVER §6 says both "treat measured values as specification" and "not something to ship verbatim as the product's theme"; D3 says the dump's structure is reused but its values are not. The neutrals, priority and schedule hues currently ship as measured. Needs an owner decision. |
