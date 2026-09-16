# Layout specs — measured from Todoist web, 2026-09-09

Reference measurement of the three core screens (sidebar, list view, task
detail) plus the quick-add composer and the confirmation modal. Every number
here is a `getBoundingClientRect` / `getComputedStyle` reading from the live
app (`app.todoist.com`, light theme, viewport 1639×878, root font 16px, body
font 13px). Nothing is estimated.

These are **specification**, not assets (see HANDOVER §6). Colours are cited by
Todoist's semantic token name so our own palette (D3) can be substituted by
role; the hex values are only there to make the tables readable. **The accent
role is already substituted: teal `#0f766e` light / `#2dd4bf` dark (D3,
2026-09-09)** — wherever a table below says "accent", read teal, not `#d33322`.

Reproduce with `research/measure-dom.js` — see the end of this file.

---

## 0. Global

| Property | Value |
|---|---|
| Font stack | `-apple-system, system-ui, "Segoe UI", "Noto Sans", sans-serif` (system font; no webfont) |
| Body font size | 13px |
| Base radius (buttons, nav rows, hit targets) | 5px |
| Card / modal radius | 10px |
| Composer radius | 12px |
| Chip radius (composer chips, small buttons) | 8px |
| Icon glyph sizes | 24 (nav, toolbar), 16 (chips, sidebar-of-detail), 12 (row metadata) |
| Standard hit target | 32×32 (icon buttons), 28×28 (secondary icon buttons), 34px tall nav rows |
| Modal overlay | `rgba(0,0,0,.4)` |
| Modal shadow | `0 2px 8px rgba(0,0,0,.16)` |
| Hover fill on neutral buttons | `rgba(0,0,0,.04)` |

### Tokens cited below (light / dark)

| Role | Token | Light | Dark |
|---|---|---|---|
| Page background | `--product-library-background-base-primary` | `#fff` | `#1f1f1f` |
| Sidebar / secondary bg | `--product-library-background-base-secondary` | `#fcfaf8` | `#262626` |
| Primary text | `--product-library-display-primary-idle-tint` | `#202020` | `#fff` |
| Secondary text | `--product-library-display-secondary-idle-tint` | `#666` | `#ccc` |
| Tertiary text (counts) | `--product-library-selectable-tertiary-on-unselected-enabled-fill` | `#aaa` | `#242424`¹ |
| Divider (row separators) | `--product-library-divider-primary` | `#eee` | `#3d3d3d` |
| Divider, faint | `--product-library-divider-secondary` | `#f5f5f5` | `#282828` |
| Border, idle (chips, cards) | `--product-library-border-idle-tint` | `#e6e6e6` | `#3d3d3d` |
| Border, focus (composer) | `--product-library-border-focus-tint` | `#b8b8b8` | `#707070` |
| Accent (primary button, links) | `--product-library-actionable-primary-idle-fill` | `#d33322` | `#d04348` |
| Accent, secondary fill (NL match highlight) | `--product-library-display-accent-secondary-fill` | `#fde7d8` | `#6f2625` |
| Secondary button text | `--product-library-actionable-secondary-on-idle-tint` | `#444` | `#e4e4e4` |
| Selected nav row fill | `--product-library-selectable-secondary-selected-fill` | `#ffefe5` | `#472525` |
| Selected nav row text | `--product-library-selectable-secondary-on-selected-tint` | `#a81f00` | `#f07f75` |
| Priority p1 | `--product-library-priorities-p1-primary-idle-fill` | `#d1453b` | `#ff7066` |
| Priority p2 | `--product-library-priorities-p2-primary-idle-fill` | `#eb8909` | `#ff9a13` |
| Priority p3 | `--product-library-priorities-p3-primary-idle-fill` | `#246fe0` | `#5297ff` |
| Priority p4 | `--product-library-priorities-p4-primary-idle-fill` | `#999` | `#a9a9a9` |
| Date: overdue | `--product-library-schedule-overdue-tint` | `#d1453b` | `#ff7066` |
| Date: today | `--product-library-schedule-today-tint` | `#058527` | `#25b84c` |
| Date: tomorrow | `--product-library-schedule-tomorrow-tint` | `#ad6200` | `#ff9a14` |
| Date: next week | `--product-library-schedule-next-week-tint` | `#692ec2` | `#a970ff` |

¹ The dark value of that token is a *fill*, not a text colour; the dark UI uses
a different token for tertiary text. Resolve when the dark sketch is drawn.

---

## 1. Sidebar (`<nav>`, 280px)

```
x=0                                             x=280
┌──────────────────────────────────────────────┐
│ 12px inset                                   │ y=0
│ [avatar 26] Name ▾           [bell 34] [◧ 32]│ 58px tall block; row is 34px, margin 12px
│                                              │
│ ┌ card: white, 1px #eee, r10, p12 ──────────┐│ (setup progress — dismissable, optional)
│ └──────────────────────────────────────────┘ │ margin 0 12px 8px
│ [+ 24] Aggiungi attività  (accent, 600)   [🎤]│ 34px row, p 0 10px
│                                              │ 4px
│  nav rows: 34px, p5, icon 24, label 14/16    │ block padding 4px 12px
│  Cerca / In arrivo(1) / Oggi(14) / Prossime  │ count: 12/24 right-aligned, 24px cell
│  Filtri ed etichette / Report                │
│                                   ↕ gap 16   │
│  I miei progetti      14/21 600 #666  [⋯][▾] │ 36px sticky group header, p 4px 0 4px 4px
│   • Personale (8)  • Lavoro (37)             │ project rows identical to nav rows
│                                              │
│  (bottom, mt auto)                           │
│  [ + ] Aggiungi un team    14/32 600 #666    │ 32px, p 0 10px
│  [ ? ] Assistenza e risorse                  │ 32px, 8px gap
└──────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Container | `width 280; bg base-secondary; no border, no shadow` |
| Horizontal inset | 12px everywhere (content width 256) |
| Account row | 34px tall, `margin 12px`, space-between. Avatar 26px circle + name `13px/32px 600 #202020` + chevron 24. Right: bell 34×34 (r5), sidebar toggle 32×32 (`bg rgba(0,0,0,.04)`, r5) |
| Add-task row | 34px, `padding 0 10px`, icon 24 with `margin 0 6px 0 -6px`, label `14px/32px 600` in accent. Trailing mic button 32×32 |
| Nav row (`li`) | 34px tall, full 256 wide; inner link 230 wide, `padding 5px`, r5; icon 24; label `14px/16px 400 #202020` with `padding 3px 0 3px 5px`; trailing 24×24 cell for count `12px/24px 400 #aaa` (accent-ish `#dc4c3e` for Inbox/Today counts) |
| Selected nav row | fill `selectable-secondary-selected` (`#ffefe5`), label colour `selectable-secondary-on-selected` (`#a81f00`) |
| Group header ("I miei progetti") | 36px, sticky, `padding 4px 0 4px 4px`; label `14px/21px 600 #666`; two 28×28 icon buttons at right |
| Gap between primary filters and projects group | 16px |
| Row hover | reveals a 28×28 "⋯" button over the count cell (absolute, right-aligned) |
| Bottom actions | two 32px rows, `padding 0 10px`, `14px/32px 600 #666`, 8px gap; pinned to bottom with 8px vertical margin |

**Fit check at 256px content width:** icon 24 + 5 pad + 5 pad-left + label + 24 count cell = 58px of chrome, so labels have 198px before truncation. "Filtri ed etichette" measures 111px. OK.

---

## 2. List view (`<main>`, fills remainder)

### 2.1 Header (two-tier)

| Tier | Spec |
|---|---|
| Toolbar | 56px tall, sticky, `padding 0 12px`, grid; right cluster: "Opzioni" button 98×32 (`13px/32px 600 #666`, icon 24 with `-6px` left margin) + two 32×32 icon buttons, 0 gap |
| Title tier (`large-header`) | 52px tall (Inbox) / 84px (Today, with subtitle); content column 800px centred; `h1 26px/35px 700 #202020`, `margin 6px 55px 9px`; subtitle "14 attività" `14px/21px 400 #666` |
| Content column | `width 800`, centred in main (`padding 0 55px 84px` on the scroll container, column starts at x = 280 + (1359−800)/2) |

### 2.2 Section header (Today view: "Scadute", "9 Set ‧ Oggi ‧ mercoledì")

| Element | Spec |
|---|---|
| Container | sticky, 32–33px tall, `padding 0 16px 1px`, `margin 0 -16px` (bleeds 16px each side of the column), white bg |
| Collapser | 24×24 icon button, absolute at x = column − 40 (only shown on hover / for collapsible sections) |
| Title | `h2` with `padding 6px 0 5px`; text `14px/21px 700 #202020` (date sections are links) |
| Action ("Ripianifica") | right-aligned button 92×32, `padding 0 12px`, `13px/32px 600` accent |
| Section spacing | first section `margin 0`, subsequent `margin-top 30px`; inbox default section has `padding-bottom 18px; margin-bottom 18px` |
| List top gap | `ul margin-top 5px` |

### 2.3 Task row (`task-list-item`, 79px with 1-line description)

```
x−32  x−3   x=0 (col)                                                  x=800
 [⋮⋮]  (○)   Title 14/21 #202020 ..........................................   ← 8px top pad
             Description 12/18 #666 (1 line, 2px below title block)
             [⊟ 0/3] [📅 sabato 10:00] [🔔] [💬 4]          Lavoro ⌂  ← meta row 16px
─────────────────────────────────────────────────────────────────── 1px #eee
```

| Element | Spec |
|---|---|
| Row | width 800 (column), `bg white`, `border-bottom 1px divider-primary`; hit area is a `role=button` div `padding 0 8px; margin-left −8px` (816 wide), r5 |
| Content block | `padding 8px 0`, `margin-right 22px`; x offset 27px from column edge (checkbox 24 + 3) |
| Drag handle | 24×24 at x = column − 32, `opacity 0` at rest, `cursor: move`, shown on row hover |
| Checkbox | 24×24 grid at x = column − 3, `margin 8px 6px 0 −3px`; inner circle 18px with 2px border in the priority colour; p1–p3 filled tint, p4 grey |
| Title | `14px/21px 400 #202020`, `padding 1px 1px 1px 0`; single line, truncates (title cell 534–592px wide when the row has trailing meta) |
| Description | `12px/18px 400 #666`, `margin-bottom 2px`, clamped to 1 line in list |
| Meta row | 16px tall, flex, items `margin-right 8px`: subtask counter (icon 16 + `12px/16px`), due date (icon 12 + `12px/18px` in schedule colour), reminder icon 12, comment count (icon 12 + count) |
| Project chip | pushed right (`margin-left auto`), `12px/20px 400 #666` + 12px icon, `margin-right −22px` so it sits flush with the column edge |
| Trailing actions | 16×24 absolute cell at right (`margin 8px −22px 0 0`) for hover actions |
| Row height | 79px with a 1-line description; 59px title-only (79 − 20) |

### 2.3b Hover states — **measured 2026-09-16**, and what they are not

The original pass could not capture these: `:hover` cannot be triggered from
`orca eval`. Orca's CLI has a real pointer `hover`, so they are measured now,
by hovering the element and reading the `:hover` chain rather than diffing
guesses.

**Hovering a task row changes exactly five things, and all five are the same
thing:** `opacity 0 → 1` on the controls it reveals —

| Revealed on row hover |
|---|
| `task_list_item__drag_handle` (§2.3's 24×24 handle) |
| the trailing actions button |
| `due_date_controls` |
| `task_list_item__comments_link` |
| one further action button |

**Nothing else changes. The row does NOT take a background on hover.** The whole
hovered chain inside it is transparent and the `li` stays `#fff` — verified by
reading every element under the pointer, not by diffing a subset. The 816×78
`task_list_item__body` carries `border-radius: 5px` and no fill, even hovered.

Sidebar item hover: a wrapper `div` 256×34, `background rgb(242, 239, 237)`
(`#f2efed`), `border-radius 5px`. The `a` inside it stays transparent, so the
fill is on the wrapper, not the link.

**Focus is still NOT measured, and the reason has changed.** It is no longer
"eval cannot trigger it": a scripted `.focus()` does not satisfy Chrome's
`:focus-visible` heuristic, and Tab could not be walked past the skip-link
through the CLI. What IS visible is that Todoist declares
`outline: #666 none 3px` at rest — style `none`, width 3 — so the ring is
almost certainly switched on under `:focus-visible` alone. Measure it with a
real keyboard before copying a number.

### 4.1 Unsaved-changes confirmation — **measured 2026-09-16**

Cancelling an edit that HAS changes raises the §5 confirmation:

```
Ignorare le modifiche non salvate?
Le modifiche non salvate andranno perse.
                                     [Annulla]  [Chiudi]
```

The editor stays open BEHIND it, so the question is rendered over the editor
rather than after closing it. An editor opened and left alone closes with no
question. Whether the dialog's own X guards the same way was NOT captured.

open-todo asks the same question in English and keeps its own button verbs —
Discard / Keep editing, as the composer already uses — so the two confirmations
in the app read alike.

### 2.4 Inline "Aggiungi attività" affordance (below a section's rows)

33px `li`, `padding 0 20px 0 1px`; button `14px 400 #808080`, `padding 0 8px 8px 9px`, `margin-left −8px`, r5, with a 17px circular "+" icon (`margin-right 11px`). Turns into the accent colour on hover. "Aggiungi sezione" appears 12px below as a centred 24px `14px 700` accent button, hidden until hover.

---

## 3. Quick-add composer (inline, replaces the "Aggiungi attività" affordance)

```
┌ r12, 1px border (#e6e6e6 idle → #b8b8b8 focused), padding 12 ────────── 800 ┐
│ Chiamare il commercialista [domani alle 10] [p1] [#Personale] @telefono      │ 16/23 400
│                                                                      ↕ 8px    │
│ [⋯28] [⌂ Personale][📅 Domani 10:00 ×][⚑ P1 ×][🔔 All'orario dell'attività]  [× 32][➜ 32] │ 32px row
└──────────────────────────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Wrapper | `li` 800×89 (one-line input), `padding 12px`, `bg white`, `border 1px`, r12 |
| Input | `role=combobox` contenteditable, `16px/23px 400 #202020`, placeholder "Nome dell'attività" |
| Natural-language match | `span[data-testid=natural-language-match]`, `inline-block`, `padding 0 4px`, r3, `bg accent-secondary-fill (#fde7d8)`, text colour unchanged. Recognised in Italian: relative dates + time ("domani alle 10"), priority ("p1"), project ("#Personale"). An unknown label ("@telefono") stays plain |
| Toolbar | `margin-top 8px`, 32px tall, `gap 4px`, chips left / actions right |
| "⋯" button | 28×28, `bg rgba(0,0,0,.04)`, r8, icon 16 |
| Chip | 28px tall, `border 1px border-idle`, r8; inner button `padding 0 6px`, icon 16, label `13px/20px 400 #666` with `margin-left 4px`. A set value adds a 22×26 "×" remove button with `r 0 8px 8px 0`. Date chip label takes the schedule colour (tomorrow → `#ad6200`) |
| Chips present (empty) | project, date |
| Chips present (after parsing) | project, date ×, priority ×, reminder |
| Actions | cancel 32×32 (icon, r8) + submit 32×32 (`bg accent`, r8, white icon); gap 8px. Submit is the mic button when the input is empty |
| Chip sum at 800 − 24 pad | 28 + 4 + 94 + 4 + 140 + 4 + 72 + 4 + 157 = 507px used of 698 available before the actions cluster. Fits with 191px spare; a long project name or a label chip will wrap before the actions do |

Cancelling with text present opens the confirmation modal (§5).

---

## 4. Task detail (modal dialog, 864×750 centred)

```
┌ r10, white, shadow ──────────────────────────────────────── 864 ┐ y=64
│ [⌂ In arrivo]                              [‹][›]  [⋯]  [×]     │ header 48, p 0 8 0 12
├───────────────────────────────────────────────── 1px #eee ──────┤
│ 604 main                          │ 260 sidebar (bg #fcfaf8, p16)│
│ p 16 16 0                         │  Progetto     12/28 600 #666 │
│ (○) Title 20/22 600               │  [⌂ In arrivo          ▾]    │ 28px value row
│     Description 14/23.1 400       │  ── #eee ──                  │ hr, 8px above/below
│     ─ #f5f5f5 ─ (ml 32)           │  Data                        │
│     [+ Aggiungi sotto-attività]   │  [📅 sabato 10:00      ×]    │
│                                   │  Scadenza ⓘ                ▸ │ (locked/upsell rows: 28px)
│ [avatar 28] ( Commenta ......  📎)│  Priorità  [⚑ P2        ▾]  │
│                                   │  Etichette                 + │
│                                   │  Promemoria ⓘ              + │
│                                   │   🔔 All'orario dell'attività ×│ 28px list row
│                                   │  Posizione ⓘ               ▸ │
└───────────────────────────────────┴──────────────────────────────┘ y=814
```

| Element | Spec |
|---|---|
| Dialog | 864×750, r10, white, `0 2px 8px rgba(0,0,0,.16)`; overlay `rgba(0,0,0,.4)`; top at y=64 |
| Header | 48px, `padding 0 8px 0 12px`; breadcrumb button 80×28 (`padding 0 8px`, icon 16, `13px/20px 600 #666`); right cluster prev/next 32×32 pair, then "⋯" and close 32×32, `gap 8px`. **The "⋯" was measured here from the start and drawn only on 2026-09-16**, when Delete gave it something it could honour; it holds one item today. The menu hanging off it is NOT measured — Todoist's was never captured — and borrows the modal's own radius and shadow rather than inventing a second card style. |
| Split | main 604 / sidebar 260 |
| Main padding | `16px 16px 0` |
| Checkbox | 24×24, same anatomy as list; `margin-top −1px` |
| Title | `20px/22px 600 #202020`, editable on click (`role=button`), x offset 35px from main's inner edge; r3 |
| Description | `14px/23.1px 400 #202020`, `margin-top 8px`, editable on click |
| Subtasks divider | `border-bottom 1px divider-secondary (#f5f5f5)`, `margin 12px 0 0 32px`, `padding-bottom 16px` |
| Add-subtask | button 172×28, `padding 0 8px`, icon 24 (`margin 0 2px 0 −6px`), `12px/28px 600 #666` |
| Comment composer | `padding 8px 0 16px 32px`; avatar 30px circle; pill button 502×30, `padding 0 46px 0 16px`, `border 1px #eee`, r15, placeholder `14px/30px 400 #666`; attach 30×30 absolute right |
| Sidebar | 260 wide, `bg base-secondary`, `padding 16px`, inner `padding 0 8px`, `gap 8px` |
| Field group | label `12px/28px 600 #666` (28px row) + value row 28px; value button spans full width (`margin 0 −8px`, `padding 0 8px`, r5), icon 16 + `12px/28px 400 #202020`, trailing chevron 24 or remove button 28×28 |
| Separator | `hr 1px divider-primary`, group `gap 8px` on both sides |
| Collapsed / locked rows | 28px, label `12px/28px 600 #666` + 16px info icon + trailing 24px chevron; these are Todoist upsells (Scadenza, Posizione) and **should not be reproduced** |

---

## 5. Confirmation modal (448×140)

| Element | Spec |
|---|---|
| Dialog | 448 wide, r10, white; top at y=114 |
| Header | `padding 16px 16px 8px`; `h1 16px/23px 600 #202020` |
| Body | `padding 0 16px`; `14px/21px 400 #202020` |
| Footer | `padding 24px 16px 16px`; buttons right-aligned, `gap 10px`: secondary 73×32 (`bg rgba(0,0,0,.04)`, `13px/32px 600 #444`, `padding 0 12px`, r5), primary 68×32 (`bg accent`, white text) |

---

## 6. Where Todoist is bad and we will not copy it (D2 calls made here)

- Upsell rows in the task sidebar (Scadenza, Posizione, Promemoria lock icon).
  Vikunja has no paywall; those rows either exist as real fields or not at all.
- The mobile-app QR banner and "Aggiungi un team" in the sidebar bottom. Nothing
  to promote.
- Comment composer as a pill with an avatar: keep the pill, drop the avatar for
  single-user instances (saves 38px of indent).
- Header toolbar reserves a 1157px-wide empty left cell. Ours can hold the
  breadcrumb / project colour instead.
- **A task row takes no hover background** (§2.3b, measured). open-todo gives
  one (`--hover-fill`), deliberately: our row is a single click target that
  opens the dialog, and a row that lights up says what is about to be clicked.
  Todoist relies on the five revealed controls to do that job instead. Recorded
  as a D2 call so the deviation is a choice rather than an accident — the
  measurement now exists either way.
- Drag handle at `opacity 0` until hover is fine on desktop but gives touch
  users no affordance. **Settled 2026-09-16 when the drag slice was built:**
  hover-only on a fine pointer, as measured, but visible at rest and dimmed
  (`opacity .45`) under `@media (pointer: coarse)` — where there is no hover,
  a hover-revealed affordance does not exist at all. It is also revealed by
  `:focus-visible`, since an invisible focused control is worse than none.

---

## 7. Reproducing a measurement

`research/measure-dom.js` is a function `(rootSelector, maxNodes) => JSON`
that walks a subtree and records tag, `data-testid`, role, aria-label, own text
(40 chars), rect, padding/margin/gap, flex settings, font, colour, background,
radius, border and position. Run it inside the Orca browser against the
authenticated Todoist tab:

```bash
P=$(orca tab list --json | python3 -c 'import json,sys;print([t for t in json.load(sys.stdin)["result"]["tabs"] if "todoist" in t["url"]][0]["browserPageId"])')
orca eval --page $P --json --expression "$(cat research/measure-dom.js)('main#content', 3000)" > /tmp/dump.json
```

Useful roots: `nav` (sidebar), `main#content` (list), `main header` (view
header), `[data-testid=task-details-modal]`, `[data-testid=task_list_editor_wrapper]`,
`[data-testid=confirmation-modal]`. Raw dumps contain the account's task text
and are **not** committed; only this derived spec is.
