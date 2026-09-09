# open-todo — Handover

**Created:** 2026-09-09
**Status:** research only. No product code yet. Platform decided (D1): web app.
**Language of record:** English (the repo is intended to be open source; the
owner's working language is Italian).

---

## 1. Purpose

Build a **genuinely good UI for Vikunja**, using Todoist's shipped interface as
the reference specification.

Vikunja is a solid open-source task backend with a mediocre interface. Todoist
has a decade of interaction design in it and an interface people actually enjoy.
The goal of this repo is to close that gap: take what Todoist's UI *does* —
measured from the live product, not guessed — and reimplement it natively
against a Vikunja backend.

This is a **reimplementation**, not a port. No Todoist code, bundles, icons,
fonts, or logos enter this repository. See §6.

---

## 2. What "reverse engineering Todoist" means here — and what it does NOT

A reconnaissance pass was run on the live Todoist web app
(`https://app.todoist.com/app/inbox`, authenticated session, 2026-09-09).
Findings:

| Layer | Finding | Reusable? |
|---|---|---|
| Frontend bundles | webpack chunks on `todoist.b-cdn.net`, CSS Modules with hashed class names (`d2b5021f`, `_2404d8ba`, `_33bcc451`) | **No.** No readable component structure; names change every build. |
| Backend protocol | `POST https://app.todoist.com/api/v1/sync` — the Sync API, not the public REST API. Batched `commands` with `temp_id`/`uuid`, incremental `sync_token`, `resource_types` (items, projects, sections, labels, filters, reminders, notes, user, day_orders, stats). Plus `/api/v1/devices`, `/api/v1/pricing`, `/api/v1/tasks/completed/stats`, `feat-flags.todoist.net`, Datadog RUM, Sentry, GA/GTM. | **No** — see the rejected option A below. |
| Design tokens | 728 CSS custom properties on `:root`, fully semantic (`--product-library-actionable-primary-idle-fill`, `…-hover-fill`, `…-on-dark-idle-fill`), light + dark | **Yes.** Already captured — see §3. |
| Layout geometry | Not in the obfuscated bundle, but fully readable from the rendered DOM via `getComputedStyle` — spacing, line heights, font sizes/weights, sidebar width, hit targets, hierarchy | **Yes**, by measurement. |
| Interaction model | Quick-add with natural-language parsing, drag reorder with persisted order, undo toasts, full keyboard navigation, inline editing | **Yes as a specification.** The implementation must be written from scratch; observing Todoist removes the design cycle, not the engineering. |

### Rejected: running Todoist's real UI against Vikunja (option A)

Considered and rejected. It would require a shim speaking Sync API v1 in front of
Vikunja (incremental `sync_token`, `temp_id`→real-id mapping, the full command
set, a fabricated `user` object with subscription/karma/feature flags), plus
republishing their bundle with DNS/cert/CSP overrides because `app.todoist.com`
is hardcoded. It breaks on every Todoist deploy, leaks telemetry to Sentry /
Datadog / GA, is a copyright problem to distribute, and yields a web app rather
than a native one. Estimated 3–6 weeks for something partially working, plus
permanent maintenance. **Do not revisit this without a new reason.**

---

## 3. What is already in this repo

- `research/todoist-tokens-light.json` — 712 resolved CSS custom properties
  captured from the live app in **light theme**. Includes the `-on-dark-`
  variants but **not** a full dark-theme resolution; capturing that requires
  switching Todoist's theme and re-running the extraction.

Extraction method (reproducible; requires an authenticated Todoist tab in the
Orca browser):

```bash
orca eval --expression "(()=>{const s=getComputedStyle(document.documentElement);\
const props=[...new Set(Array.from(document.styleSheets).flatMap(ss=>{try{return Array.from(ss.cssRules)}catch(e){return []}})\
.filter(r=>r.selectorText&&/:root|^html/.test(r.selectorText))\
.flatMap(r=>Array.from(r.style).filter(p=>p.startsWith('--'))))].sort();\
const o={};props.forEach(p=>{const v=s.getPropertyValue(p).trim();if(v)o[p]=v});return JSON.stringify(o,null,2)})()"
```

---

## 4. Open decisions — settle these before writing product code

Each needs an answer from the owner. Decided items keep their rationale here
rather than being deleted, so the reasoning survives.

### D1 — Platform and stack — **DECIDED 2026-09-09: web app in this repo**

open-todo is a **web application** living in this repository, targeting
self-hosted Vikunja instances (the owner's runs on `pinguino`). Rationale: this
is where Vikunja's users actually are — Linux and self-hosting — and the Apple
platforms are already covered by Veyrn (`github.com/alvistar/Vikunja-Tasks`,
SwiftUI/AppKit).

Consequences:

- Starting from zero: no API client, no offline layer, no auth. Veyrn's Swift
  code is a useful reference for the Vikunja API surface but is not portable.
- Being web-to-web with the reference product, the measured Todoist layout
  transfers directly instead of needing translation to native idioms.
- Veyrn is unaffected. Nothing here is a prerequisite for it.

### D2 — How faithfully to copy the layout

Now that D1 is web, the platform-translation problem is gone: measured spacing,
type scale and layout structure can be applied as measured. Remaining judgement
is about where Todoist is actually *bad* and should not be copied — that is a
per-screen call, made during the measuring pass.

### D3 — Brand identity

*Recommendation:* pick a distinct accent color (not Todoist's `#d33322`) and
draw original icons. Cheap, and it removes the trade-dress question entirely
(§6).

### D4 — Implementation order for the interaction model

*Recommendation:* quick-add with natural-language parsing first — it is the
single most-felt difference against Vikunja's own UI. Then keyboard navigation,
then drag reorder + persisted order, then undo.

---

## 5. Data model gap: Vikunja ↔ Todoist

Required in every scenario; scope depends on D1. Known mismatches to map:

- Priority: Vikunja 0–5 vs Todoist p1–p4 (inverted sense)
- Labels vs tags
- Vikunja kanban buckets vs Todoist sections
- Recurrence syntax (Todoist's natural-language repeat rules have no Vikunja equivalent)
- Saved filters / views
- Vikunja has no `sync_token`-style incremental protocol

This mapping table should be written into `docs/` before UI work starts.

---

## 6. Legal boundaries — non-negotiable

- **Do not** copy Todoist source, bundles, CSS files, icons, illustrations,
  logos, or proprietary fonts into this repository.
- **Do** treat measured values (colors, spacings, type scale) and observed
  behaviour as specification. Reimplementing look-and-feel is the accepted
  practice; verbatim asset copying is not.
- **Do not** clone the full brand identity — Todoist red plus Todoist-shaped
  icons plus a similar name together starts to be trade dress. D3 resolves this.
- The token dump in `research/` is reference material for deriving our own
  palette, not something to ship verbatim as the product's theme.

---

## 7. Immediate next steps

1. Settle the web stack (**D5**, below): framework, rendering model, and how the
   browser authenticates against a self-hosted Vikunja (Vikunja's API is
   token-based; CORS on a self-hosted instance is a real constraint to check
   before choosing a pure-SPA shape).
2. Capture the dark-theme token set (same method, theme switched).
3. Measure and record layout specs for the three core screens — inbox list, task
   detail, sidebar — as numeric specs plus hand-written HTML sketches
   (see the owner's `design-sketch` skill; never AI-generated mockup images).
4. Write the Vikunja↔Todoist data-model mapping table (§5).
5. Only then start product code.

### D5 — Web stack (open)

Undecided. Needs: framework, SSR vs pure SPA, offline story (if any), and the
auth/CORS approach against a self-hosted Vikunja. Deployment target is a
self-hosted box, so a single static bundle plus a thin proxy is the shape to
beat.

---

## 8. Context for whoever picks this up

- The owner runs personal tasks on a self-hosted Vikunja instance; the existing
  Apple client is Veyrn (`Vikunja-Tasks`).
- Recon in this document was done through the Orca browser's `orca eval` against
  a logged-in Todoist tab; that session may no longer exist.
- Never `git push` or open a PR without the owner's explicit go-ahead in the
  current session.
