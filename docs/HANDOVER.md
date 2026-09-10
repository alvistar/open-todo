# open-todo — Handover

**Created:** 2026-09-09
**Status:** foundation slice built (read-only app). All owner decisions taken: D1 (web app), D5 (React + Vite SPA, direct to Vikunja, no proxy), D3 (own brand, teal accent), D4 (slice order), D6 (live refresh: polling now, WebSocket task events via upstream PR). D2 is a per-screen call during measuring.
**Last session:** 2026-09-10. Quick-add closed against §5 (D-vocab): the date grammar is now enforced rather than merely documented, out-of-grammar phrases are reported instead of silently reinterpreted, and a quoted line opts out entirely. Next: keyboard navigation (D4 step 2).
**Language of record:** English (the repo is intended to be open source; the
owner's working language is Italian).

---

## 0. Read this first (new session starting from this repo)

You are picking this up cold. The repo now contains this document, the
research material, and a working read-only web app (the foundation slice).
`pnpm install && pnpm dev` runs it; see the README for how to point it at an
instance.

**Do this, in order:**

1. Read §1 (purpose) and §2 (what was found and what was rejected). Do not
   re-derive them — the reconnaissance pass is done and the Todoist tab that
   produced it is probably gone.
2. D3, D4 and D5 are decided (§4). Do not reopen them; D2 is settled
   per screen during the measuring pass.
3. Go to §7 and start at its first unfinished step.

**How the owner wants decisions handled:** one at a time, as a written brief in
the message (mechanism → what's wrong → why it matters → cost of each option →
one flat recommendation), followed by a short options question. Do not bundle
several decisions into one turn, and do not settle a material one silently.

**Do not** `git push` or open a PR without explicit go-ahead in that session.

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

- `research/todoist-tokens-light.json` — 713 resolved CSS custom properties
  captured from the live app in **light theme** (`theme_todoist`, the default).
- `research/todoist-tokens-dark.json` — the same 713 properties resolved under
  **dark theme** (`theme_dark`), captured 2026-09-09. 336 values differ from
  light; the key sets are identical, so the two files diff cleanly by key.

How Todoist themes: a class on `<html>` (`theme_todoist`, `theme_dark`,
`theme_tangerine`, …) selects override rules already present in the loaded
CSS; `.theme_dark` carries 439 overrides. The dark capture therefore swapped
the class locally, resolved, and restored `theme_todoist` — no account setting
was changed. Same trick works for any other theme name listed above.

- `docs/layout-specs.md` — **numeric layout spec** of the sidebar, list view
  (inbox and Today), task-detail modal, quick-add composer and confirmation
  modal, measured 2026-09-09 with `research/measure-dom.js`. Colours cited by
  semantic token role with light and dark values. Includes the per-screen D2
  calls (what not to copy).
- `docs/sketches/reference-20260909.html` — hand-written HTML sketch of those
  screens at the true 1639×878 viewport, light and dark, with fit-check
  annotations. Placeholder icons and accent; open it in a browser.
- `research/measure-dom.js` — the DOM-walk used for the measurement. Raw dumps
  are not committed (they contain the account's task text).
- `docs/data-model-mapping.md` — Todoist → Vikunja mapping (§5 below), with
  the ordering model for D4 step 3 and the quick-add grammar for D4 step 1.

Token extraction method (reproducible; requires an authenticated Todoist tab
in the Orca browser — find its `browserPageId` with `orca tab list --json`):

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

### D3 — Brand identity — **DECIDED 2026-09-09: distinct accent, original icons, name stays `open-todo`**

Open-todo uses its own accent colour (not Todoist's `#d33322` or its family)
and an original SVG icon set. **Hue decided 2026-09-09: teal — `#0f766e` in
light, `#2dd4bf` in dark (dark text `#062a26` on filled dark-accent buttons).**
Chosen on the full-layout mockup (`docs/sketches/mockup-accent-20260909.html`)
against indigo (collides with p3 blue and the next-week purple) and burnt
orange (collides with p2 and tomorrow, and reads Todoist-adjacent). Teal
collides with none of the eight meaning-bearing priority/date colours and
passes WCAG AA on filled buttons in both themes (5.5:1 light, 8.3:1 dark).
Derived tints used in the mockup: light secondary fill `#d1ebe7`, selected
row `#e1f0ed` / text `#0b5c56`; dark secondary fill `#1f4a44`, selected row
`#233f3b` / text `#8ee6da`. Icons are still to be drawn. The name `open-todo` stays:
it is generic enough on its own, which is exactly why the other two elements
must carry the distance from Todoist's trade dress (§6). The token dump's
*structure* (semantic names: actionable-primary / hover / on-dark) is reused;
its *values* are not.

Rejected: staying in Todoist's red family (the combination with a "todo" name
is the trade-dress risk); a neutral placeholder to be branded later (the
placeholder tends to become permanent and every sketch would be redone).

### D4 — Implementation order for the interaction model — **DECIDED 2026-09-09**

After the foundation slice (login, read-only project/task list at the measured
layout — no proxy, see the D5 revision), the interaction slices are built in
this order:

1. **Quick-add with natural-language parsing** — the most-felt difference
   against Vikunja's UI; gives a daily-usable app at slice one. Its parser must
   map dates, priority and recurrence onto Vikunja's fields, which is why the
   §5 mapping table is written first.
2. **Keyboard navigation** — focus model across list and detail panes; cheap
   once the list exists.
3. **Drag reorder with persisted order** — `dnd-kit` for the gesture; the real
   work is how Vikunja's `position` field and kanban buckets represent order.
   **Check Vikunja's position semantics in Veyrn's Swift code during the
   foundation slice**, so the list component is not built on a wrong assumption.
4. **Undo toasts** — depends on every mutation being reversible; cheapest last.

Rejected: drag reorder first (weeks before anything is usable; mapping table
postponed); keyboard first (polish before the ability to add quickly).

### D6 — Live refresh — **DECIDED 2026-09-09: poll behind a `LiveSource` interface; upstream PR for WebSocket task events in parallel**

Vikunja has no SSE. Its WebSocket (`/api/v1/ws`, since 2.3.0, present on
`pinguino`) only carries `notification.created` and `timer.*`; task events
exist on the internal bus (webhooks) but are not exposed. Decision: v1 polls
`GET /tasks?filter=updated >= …` every 20 s while visible, uses
`notification.created` as a wake-up, and hides both behind `LiveSource` so a
`WebSocketSource` can replace them without touching the UI. In parallel, open
a PR to Vikunja adding `task.*` to the WebSocket with per-project
subscription. Full detail and the verified protocol: `docs/data-model-mapping.md` §7.

### D5 — Web stack — **DECIDED 2026-09-09, REVISED the same day: React + Vite static SPA talking to Vikunja directly. No proxy.**

Two axes, intertwined.

**How the browser reaches Vikunja.** Vikunja exposes a token-based REST API.
Either the browser calls it directly — in which case everything depends on how
CORS is configured on each installer's self-hosted instance, **which has not
been verified and must be tested against `pinguino` before this option is
chosen** — or a thin proxy serves the bundle and forwards `/api`, which makes
the CORS question disappear by construction and takes the token out of
`localStorage`.

```
direct:  browser ──token──> vikunja:3456              CORS depends on the instance
proxy:   browser ─────────> open-todo ──> vikunja:3456   one origin, token server-side
```

**Framework.** The app sits entirely behind a login, so SSR buys nothing: no
SEO, no public first paint. That leaves a static SPA. The real difference
between the candidates is not syntax, it is ecosystem depth for the three hard
parts already identified: **drag reorder with persisted order**, **virtualized
lists**, **command palette / quick-add**. React has `dnd-kit` and `TanStack`,
which are more mature than the Svelte equivalents, and those are exactly the
weeks-long work. Todoist is itself React, so a measured behaviour translates
directly.

Honest counterpoint: Svelte is nicer to write and ships a smaller bundle, and
for a self-hosted app with a few hundred tasks the weight is not a real problem.
It is not a wrong choice — it just costs more on the three hard parts.

**Cost of getting it wrong.** React+Vite: more boilerplate for the life of the
project. SvelteKit: you reach drag reorder and hand-roll what `dnd-kit` gave
you. Next.js: an SSR runtime you never use, on a self-hosted box where every
extra dependency is someone else's maintenance. Deferring: blocking — a layout
cannot be measured into nothing.

**Decision (revised):** React + Vite as a static SPA that calls the Vikunja
API **directly from the browser**. The SPA asks for the Vikunja URL on first
run and stores it. It is deployable as a folder of static files (Caddy, nginx,
GitHub Pages). **A proxy is not part of the project for now** — the owner ruled
it out of consideration on 2026-09-09; it is not on the roadmap and should not
be proposed again without a new reason.

**Why the first version of D5 was wrong.** The morning probe showed
`vary: Origin` with no `access-control-allow-origin` and was read as "CORS is
closed on the instance". Reading Vikunja's source (`pkg/config/config.go`,
`pkg/routes/routes.go` on `main`) shows the real state: `cors.enable` defaults
to **true**, and `cors.origins` defaults to `http://localhost:*`,
`http://127.0.0.1:*` plus the instance's own `service.publicurl`. The probe's
foreign origin simply was not in that list. The fix is one config line per
install:

```yaml
cors:
  origins:
    - https://todo.example
```

(or `VIKUNJA_CORS_ORIGINS=https://todo.example`). The middleware sends
`Access-Control-Allow-Credentials: true`.

**Login without a proxy.** Username/password is `POST /api/v1/login` from the
browser, as Vikunja's own frontend does. OIDC: `POST
/api/v1/auth/openid/{provider}/callback` takes the client's `redirect_url` in
the body, so the SPA runs the OIDC redirect itself; the SPA's URL must be added
to the provider's valid redirect URIs (Keycloak client `vikunja` on the
reference instance). **Not yet tested against the owner's Keycloak.**

**Token custody.** Vikunja's official frontend keeps the JWT in
`localStorage`; open-todo doing the same is at parity with Vikunja, not below
it. The earlier "proxy keeps the token server-side" argument was true but
bought nothing Vikunja's own users do not already accept.

The original probe, for the record (re-run to check an instance's CORS list):

```bash
curl -sS -o /dev/null -D - -X OPTIONS \
  -H "Origin: https://open-todo.example" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" \
  https://vikunja.internal.thealvistar.com/api/v1/tasks/all | grep -i access-control
```

Framework rationale (unchanged): the React ecosystem (`dnd-kit`, TanStack)
covers the three expensive parts — drag reorder with persisted order,
virtualized lists, command palette. SvelteKit was the honest runner-up and was
not chosen only because of those three parts.

### D-parser — Natural-language date parsing — **DECIDED 2026-09-10: chrono-node for the date/time layer only**

The quick-add parser was hand-written. The question was whether a library or a
small language model should replace it. Researched 2026-09-10:

- **No library does the whole job.** Nothing on npm parses Todoist-style
  quick-add. The general NLP packages classify intent, which is a different and
  larger problem.
- **`rrule` is unsafe for us.** `RRule.fromText` reads recurrence in English but
  does not fail on Italian — it *silently* returns `FREQ=YEARLY;INTERVAL=1` for
  `ogni giorno`, `ogni 2 settimane` and `ogni lunedì`. A wrong repeat would be
  written to Vikunja with nothing shown to the user. **Rejected.**
- **A browser LLM is disproportionate.** Sub-1 GB quantised models over WebGPU
  (~83% browser coverage) to interpret a 40-character phrase, in a static SPA
  that must keep working offline of any third party. An API call would break D5
  (no proxy, no telemetry). **Rejected.**
- **`chrono-node` is worth taking, for dates and times only.** It has both an
  `it` and an `en` locale, refuses impossible dates (`2026-13-45`, `31/2`,
  `29 feb 2027`), and absorbs the preposition in `tomorrow at 10:30`.

**Decision: `chrono-node` replaces the hand-written date/time matchers.
Recurrence and the sigils stay ours.** The research did not weaken that split,
it confirmed it: the two most serious defects the review found — `@monday`
parsed as a date, `every 2nd tuesday` scheduled as one Tuesday — are
**orchestration**, not date parsing. chrono reproduces both when called naively.
What prevents them is the masking order in `parse.ts`, which no library
provides.

Guards added around chrono, each with a test (`src/model/quickadd/datePhrase.ts`):

| Guard | Why |
|---|---|
| Both locales run; earliest match wins, then longest, then Italian | chrono's `en-GB` parser reads `Apr 30` as **1 April 2030** — a confident four-year error. The Italian parser is right, and is day-first, which §5 requires for `15/9`. |
| A bare weekday resolving to today is pushed a week | chrono returns today for `gym wednesday` typed on a Wednesday; a task means the day to come. `next wednesday` is already a week out and is not pushed twice. |
| A clock time counts only with a marker (`:`, `3pm`, `at`/`alle`/`ore`) | chrono reads the stray `13` in `x 45/13 15/9` as 13:00 — a time the user never typed. |
| `end of month` / `fine mese` matched before chrono | Neither locale has them, and §5 lists them. Done here rather than as a chrono custom parser because a custom parser sees only an instant: at 00:30 in Rome that instant is still the previous month in UTC. |
| A day+month chrono declines is retried with each following year | `29 feb` is not a date in 2026 or 2027, so chrono returns nothing. The retry only succeeds on a real date, so `30 feb` stays refused. |

Cost: **+16.1 kB gzip** (86.2 → 102.3 kB), measured by building both ways.

Behaviour that changed, deliberately: `tonight`/`stasera` stay all-day rather
than 22:00, because the phrase names a day and D-map-2 owns the time.

### D-vocab — Closing the grammar chrono opened — **DECIDED 2026-09-10: §5 is an acceptor; chrono resolves, §5 admits**

D-parser adopted chrono for dates and times. What went unnoticed is that §5
described the date vocabulary as a **closed table**, which was true by
construction while the matchers were hand-written and became a claim nobody was
checking the moment chrono arrived. chrono's vocabulary is far wider and cannot
be configured per word, and `parse.ts` removes whatever the date layer matched
from the title — so the user lost a word *and* gained a due date. Measured on
`2ab17ce`, reference 10 September 2026, Europe/Rome:

| typed | title became | due |
|---|---|---|
| `I sat down with the team` | `I down with the team` | Sat 12 Sep |
| `il mar mosso` | `il mosso` | Tue 15 Sep |
| `March report` | `report` | 1 Mar 2027 |
| `Friday to Monday` | *(empty)* | Fri 11 Sep |
| `feb 29` | *(empty)* | 1 Feb **2029** |
| `Sep 15` | *(empty)* | 1 Sep **2015** |

The last two are the ones worth remembering: chrono reads a trailing number
after a month name as a **year**, with the day merely implied. `Apr 30` escapes
only because the Italian parser also matches it and wins the tie.

**Decision: §5 becomes an acceptor.** chrono keeps the *resolution* — DST, leap
years, roll-forward, refusal of impossible dates — which is where every subtle
bug lived and which was the valuable part of the deletion. What comes back is
only the *acceptor*: an anchored transcription of the §5.1 table, applied to
every candidate before the earliest-wins sort, plus two semantic rules (a month
name needs a certain `day`; nothing may resolve before today). Out of grammar
means the text stays in the title, no date is invented, and the composer says
why — the treatment rejected recurrence has had since the parser was written.

`scripts/quickadd-corpus-diff.mjs` measures any future amendment the same way it
measured this one: 37 of 98 phrases changed — 35 forms withdrawn, none of
them a §5 row, plus two leap-day phrasings that now resolve and did not before. The full
excluded list, with the reason for each, is `docs/data-model-mapping.md` §5.1.

Three findings worth not re-deriving, each reproduced against the code:

- **A length or digit heuristic does not work.** A digit anywhere in the span
  legitimises the abbreviation beside it, so `I sat at 10 with the team` still
  becomes Saturday 10:00. A stoplist of words is the same idea in a new coat.
- **The "instant idiom" predicate must not test `isCertain("month")`.** chrono
  marks day, month *and* year certain on `now`, `a sec`, `a second` and `in a
  minute`, so that clause would stop the predicate firing at all. What actually
  separates them from `sat` is: certain hour, no weekday, no digit.
- **De-duplicating rejected spans by exact offsets is not enough.** Both locales
  parse every line, so `this weekend` is `[5,12)` in Italian and `[0,14)` in
  English — two warnings for one phrase — and `Apr 30` is *accepted* by one
  locale and *rejected* by the other at the same offsets, which would warn about
  a phrase that correctly set a date. An accepted span silences what it overlaps.

Investigated and rejected on the way, do not reopen: per-word constraints inside
chrono (removing `ITWeekdayParser` also removes `martedì`; filtering by
`constructor.name` breaks per version); browser NLP (`it-compromise` 0.3.0 tags
`mar` as `Date|Month`); Python NLP in the browser (Pyodide 0.28 ships 340
packages and has neither `spacy` nor its Cython chain — `thinc`, `blis`,
`cymem`, `murmurhash` — nor `stanza`/`torch`; the runtime alone is 11.5 MB
against a 102 kB app).

**If open-todo ever grows a backend**, the technique to reach for is `obl` /
`advmod` on a UD dependency tree (Stanza), **not** an LLM — spaCy attaches
`colleghi` as `obl` in "gio con i colleghi", so a naive rule fires on it and the
tree is what tells them apart. Even then it belongs in a pre-save check, never
in the per-keystroke path: Stanza measured 74 ms mean / 96 ms p95 against this
parser's 0.04–0.32 ms. **Caveat on that comparison:** the latency figures are
solid (200–500 samples), but the *quality* comparison rests on six hand-picked
sentences. It is a probe, not an evaluation, and nothing should be decided on it
without a real corpus.

**Also decided here:** wrapping the whole quick-add line in matching quotes
turns every rule off and takes the rest literally. Nothing can distinguish a
task genuinely called "Buy milk tomorrow" from the same words meaning a date, so
the user needs a way to say which. This is Vikunja's *behaviour*, reimplemented —
Vikunja is AGPL and open-todo is MIT (§6), so no code was copied.

---

## 5. Data model gap: Vikunja ↔ Todoist

Required in every scenario; scope depends on D1. Known mismatches to map:

- Priority: Vikunja 0–5 vs Todoist p1–p4 (inverted sense)
- Labels vs tags
- Vikunja kanban buckets vs Todoist sections
- Recurrence syntax (Todoist's natural-language repeat rules have no Vikunja equivalent)
- Saved filters / views
- Vikunja has no `sync_token`-style incremental protocol

Written up in `docs/data-model-mapping.md` (2026-09-09), including three
conventions (priority scale, all-day dates, quick-add sigils) and the
verified per-view float `position` semantics.

---

## 6. Legal boundaries — non-negotiable

**Licence — DECIDED 2026-09-10: MIT.** `LICENSE` at the repo root, `license`
field in `package.json`. Until this was set the repo had no licence at all,
which meant nobody could legally reuse it despite the stated intent to open it.

This also settles a question that was open while the parser was being built:
**Vikunja's own source cannot be copied into open-todo.** Vikunja is
AGPL-3.0-or-later, so porting its `parseTaskText.ts` would relicense open-todo
under the AGPL. It has not been copied — the parser here was written from
scratch and accepts Todoist's sigils, not Vikunja's. open-todo uses Vikunja's
public HTTP API only, which carries no such obligation.

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

1. ~~Settle D3, D4, D5~~ — done 2026-09-09.
2. ~~Capture the dark-theme token set~~ — done 2026-09-09
   (`research/todoist-tokens-dark.json`).
3. ~~Measure and record layout specs~~ — done 2026-09-09
   (`docs/layout-specs.md`, `docs/sketches/reference-20260909.html`). Still
   open from that pass: hover/focus states were not measured (`:hover` cannot
   be triggered from `orca eval`); the "Prossime" (upcoming) and project-with-
   sections views were not measured; **the D3 accent hue has not been picked
   yet** — the sketch uses the measured accent as a placeholder.
4. ~~Write the Vikunja↔Todoist data-model mapping table~~ — done 2026-09-09
   (`docs/data-model-mapping.md`). Position semantics verified from Vikunja's
   own source, not Veyrn (Veyrn never writes positions). Its §6 records what was
   verified against `pinguino` the same day; D-map-2 (all-day dates) follows
   Vikunja's own `default_due_time` setting with Veyrn's 20:00 fallback; only
   webhooks remain open.
5. ~~Pick the D3 accent hue~~ — teal, decided 2026-09-09 on
   `docs/sketches/mockup-accent-20260909.html`.
6. ~~Start product code: foundation slice~~ — done 2026-09-09. Vikunja-URL +
   login screen, API client, read-only Inbox/Today/project lists at the
   measured layout, `PollingSource` behind `LiveSource`, static build. Notes
   for whoever continues:
   - **Verified against `pinguino` on 2026-09-09**, both at the API level and
     with the rendered app driven in a browser. The integration test
     (`VIKUNJA_TEST_URL` + `VIKUNJA_TEST_TOKEN`, see the README) doubles as the
     probe for the assumptions that were open; re-run it after a server
     upgrade. Answers recorded in `docs/data-model-mapping.md` §6 items 7-12.
   - Two defects only real data exposed: the toolbar collapsed from 56px to 36
     because it was a shrinkable flex item (five fixture rows never overflowed),
     and times were rendered in Vikunja's `settings.timezone`, which on this
     instance is an untouched `GMT` while the owner is in Italy.
   - The incremental poll deliberately does **not** apply the view's filter;
     only `updated >= mark`. Scoping it makes the poll blind to tasks that
     *leave* the view (completed, moved), which is the change users most want
     to see. See the commit message on `src/live/`.
   - `UI_LOCALE` in `src/model/dates.ts` is the one place i18n will touch.
   - D4 step 3's open question about position semantics is already answered in
     `docs/data-model-mapping.md` §3; Veyrn is not a reference (it never writes
     positions).
7. ~~D4 slice 1 (quick-add)~~ — done 2026-09-09: parser, composer at the §3
   geometry, task creation with labels and recurrence, confirmation on
   discard. `!1`-`!5` is taken literally rather than through D-map-1, because
   it is Vikunja's own syntax and forcing it through would write 4 for `!5`.
   Dates and times moved to `chrono-node` on 2026-09-10 (D-parser), and the
   §5 grammar was closed against it the same day (D-vocab) — both entries are
   in §4, and §5.1 of the mapping doc is the enforced table.
   Next: keyboard navigation, then drag reorder, then undo.
8. Parallel, off the critical path: the upstream Vikunja PR for `task.*`
   WebSocket events (D6). Start from `pkg/websocket/listener.go` and
   `validEvents` in `connection.go`; the open question is how to resolve the
   recipients of a project-scoped event. Before the OIDC part: add the SPA's origin to `cors.origins` on
   `pinguino` and its URL to the Keycloak client's redirect URIs.

---

## 8. Context for whoever picks this up

- The owner runs personal tasks on a self-hosted Vikunja instance; the existing
  Apple client is Veyrn (`Vikunja-Tasks`).
- Recon in this document was done through the Orca browser's `orca eval` against
  a logged-in Todoist tab; that session may no longer exist.
- Never `git push` or open a PR without the owner's explicit go-ahead in the
  current session.
