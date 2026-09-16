# open-todo — Handover

**Created:** 2026-09-09
**Status:** the app reads *and writes*: quick-add, completion, a keyboard, a
full task-detail dialog, a manual order that persists in Vikunja, and undo
toasts. **All four D4 interaction slices are built.** All owner decisions taken: D1 (web app), D5 (React + Vite SPA, direct to Vikunja, no proxy), D3 (own brand, teal accent), D4 (slice order), D6 (live refresh: polling now, WebSocket task events via upstream PR). D2 is a per-screen call during measuring.
**Previous session:** 2026-09-15 — two of them, in sequence. The first made a task completable (D-write) and turned a bare repeat adverb into an offer rather than a schedule (D-adverb); until then the app could log in, list and create and nothing else, which D4 had not noticed because it ordered the interaction slices and assumed the mutations under them existed. The second gave the list a keyboard (D4 step 2) and built the whole task-detail dialog (D-detail).

**Last session:** 2026-09-16 — D4 step 3 (D-order): a list can be reordered by drag or by Alt+Arrow, and the order is written to Vikunja, in projects, in Inbox and in Today. The slice was larger than it looks, because the app could not READ an order either — every list was a flat `GET /tasks` where §3 says `position` means nothing. The probes that opened it found §3 **wrong about who renumbers** a crowded view (§6 item 23: the client must), and driving the app found Today silently losing its "Overdue" heading with all 713 tests green. **D4 is complete** (quick-add, keyboard, drag reorder, undo toasts). **Next:** the incomplete Italian language pack (§4, D-vocab) is the ranked candidate — see §7 item 13.
**Language of record:** English (the repo is intended to be open source; the
owner's working language is Italian).

---

## 0. Read this first (new session starting from this repo)

You are picking this up cold. The repo contains this document, the research
material, and a **working app that reads and writes** — quick-add with
natural-language parsing, completion with an undo window, a keyboard, and a
full task-detail dialog. `pnpm install && pnpm dev` runs it (port 5173; 5199 is
what the last sessions used); see the README for how to point it at an instance.

The gate is `npx tsc -b && npx biome check . && npx vitest run` — 716 tests,
biome clean across all 145 files. Plus `node scripts/sync-version.mjs --check`
and `node scripts/sync-design-tokens.mjs --check`. **Write tests against a real
server are opt-in**: `VIKUNJA_TEST_URL` + `VIKUNJA_TEST_TOKEN` +
`VIKUNJA_TEST_WRITE=1` on `src/api/integration.write.test.ts`. They are
self-cleaning, and they run against the owner's **real** instance — keep the
discipline the last sessions kept: prefix scratch tasks `open-todo `, delete
them, and check there are zero leftovers.

**Do this, in order:**

1. Read §1 (purpose) and §2 (what was found and what was rejected). Do not
   re-derive them — the reconnaissance pass is done and the Todoist tab that
   produced it is probably gone.
2. D3, D4 and D5 are decided (§4). Do not reopen them; D2 is settled
   per screen during the measuring pass.
3. Go to §7. Items 1-12 are done; **item 13 is the open list, ranked**.
4. Before touching any write, read D-write, D-detail and D-order in §4 and
   items 13-30 of `docs/data-model-mapping.md` §6. `POST /tasks/{id}` is not a
   patch — every omitted field is erased — and several of the traps under that
   are silent. A position is the one write that does NOT go through
   `updateTask`: it is not a task column, and the bulk route refuses it (item
   27).

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
2. ~~**Keyboard navigation**~~ — done 2026-09-15: the list is **one tab stop**
   with a roving `tabindex`, not fifty. The handler hangs off each ROW, not off
   the scroll container, because the quick-add composer renders in that
   container's footer and a handler up there would see every keystroke typed
   into a task name (`u` would undo while you were spelling "usare").
   **The key map was corrected the same day, in the commit that gave Enter a
   destination** (`90fe290`): it is now Todoist's own, read off the product's
   shortcut panel rather than invented — Enter **opens**, `E` completes, `Z`
   undoes, `J`/`K` alias the arrows. The first cut shipped Enter=complete and
   `u`=undo only because `TaskRow.onOpen` had no destination yet; D-detail gave
   it one. Hover and focus states are still unmeasured (§7 item 3).
3. **Drag reorder with persisted order** — `dnd-kit` for the gesture; the real
   work is how Vikunja's `position` field and kanban buckets represent order.
   **Check Vikunja's position semantics in Veyrn's Swift code during the
   foundation slice**, so the list component is not built on a wrong assumption.
4. ~~**Undo toasts**~~ — done 2026-09-16: a toast region bottom-left, with an
   Undo on the dialog's sidebar picks and a home for the reorder failure. See
   **D-toast** below for what deliberately did NOT move into it.

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
| `ore` is rewritten before parsing | chrono's Italian locale knows `alle` and not `ore` at all, so "domenica ore 15" returned the day with no time and left the words in the title — a form §5 has always listed. `alle ore 15` blanks the redundant `ore` (same length, no offset shift); a bare `ore 15` becomes `alle 15` (+1, offsets mapped back). Never after a number: in "tra 2 ore" the word is the unit. |
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

### D-write — Writes beyond creation, starting with completing a task — **DECIDED 2026-09-15**

D4 ordered the interaction slices (quick-add, keyboard, drag reorder, undo) and
assumed the mutations underneath them existed. They did not. Until this
decision the API client could `login`, read, `createTask` and `addLabel` and
nothing else: **a user could write a task and never tick it off**, and
`TaskRow`'s `onToggleDone` prop had been declared since the foundation slice
with no call behind it. Completion is therefore not a step inside D4 — it is the
layer D4 stands on, and it comes before D4 step 2.

**The finding that shapes everything below.** `POST /api/v1/tasks/{id}` is not a
patch. In Vikunja 2.5.0 `updateSingleTask` (`pkg/models/tasks.go`) merges the
body over the stored row with `mergo.WithOverride`, which skips zero values, and
then **re-applies every zero by hand** so that an omitted field is an erased
field. A body of `{"id":123,"done":true}` wipes `description`, `due_date`,
`start_date`, `end_date`, `priority`, `percent_done`, `hex_color`,
`repeat_after`, `repeat_mode`, `is_favorite`, every reminder and every assignee.
`title`, `project_id`, `labels`, `related_tasks` and `position` survive. The
obvious one-line toggle would therefore destroy the recurrence the quick-add
parser exists to write.

**Decisions:**

1. **The wire call is `POST /api/v1/tasks/bulk`** with
   `{"task_ids":[id],"fields":["done"],"values":{"done":true}}`. It is the only
   v1 path that reaches the `fields` branch, where columns that are not named
   are re-read from the stored row instead of zeroed. A plural endpoint used for
   one row, chosen because it is safe by construction rather than by convention,
   and because it stays on `/api/v1` (§6) and costs one round trip.
   Rejected: read-modify-write on `POST /tasks/{id}` (two round trips per click,
   and the update response is not re-hydrated, so `labels` and `related_tasks`
   come back hollow and a naive cache write loses them); `PATCH /api/v2/tasks/{id}`,
   which this build does synthesise and which has the cleanest semantics, but
   moves a write onto a surface nothing here has verified. It is the fallback if
   the bulk probe fails against `pinguino`.

2. **`updateTask` is written as a general patch** — `(task, values)` — with
   the done toggle as its only caller for now. Inline edit, reschedule and
   project moves are the same call. `deleteTask` (`DELETE /tasks/{id}`) lands
   beside it, **API only, with no affordance in the UI**: its reason to exist
   today is that the write test must not leave litter on `pinguino`, and a
   delete button brings its own confirmation, entry point and reversibility
   questions, which belong to their own slice.
   It takes the whole task, not an id, because the echo above has to come from
   somewhere and a caller cannot be trusted to remember it. The contract is
   that the task is a copy the SERVER produced: a hand-built object missing
   `reminders` echoes `[]`, and `[]` is precisely how the server is told to
   delete them. Nothing on the wire distinguishes the two.

3. **Completing is optimistic, with a rollback.** The row updates on click; a
   failed call puts it back and says why *on the row itself*, not in a banner or
   a toast. A pending checkbox on a self-hosted instance is the exact
   Vikunja-UI feeling this repo exists to remove (§1). The general toast system
   belongs to D4 step 4 and is not built early here.
   Two things the review added, recorded here rather than left as undocumented
   behaviour: a failure message stays twice as long as a success (10s against
   6s, because it has to be read), and **a click on a failed row is the retry**
   — the double-click guard keys off a write being on the wire, not off a
   message being on screen, or a failure would deaden its own checkbox for ten
   seconds and read as a second failure.

4. **A completed row lingers for about six seconds with an Undo, then goes.**
   Every view filters `notDone()` on the server and `!task.done` in `belongs()`,
   so a completed task leaves the app entirely and is recoverable only through
   Vikunja's own web UI. The linger is a set of ids in the view layer that
   overrides `belongs()` — the first app state that does not come from the
   server — so it is deliberately short-lived and is dropped on navigation. Not
   chosen: keeping the row until the view changes (a to-do list that fills with
   done things), and keeping it until the next full fetch (~100 s, a duration
   that cannot be explained to the user).

5. **A recurring task is not completed by the server; it is advanced.**
   `updateDone` runs the `repeat_mode` handler, which sets `done` back to
   `false` and moves `due_date`, `start_date`, `end_date` and the reminders
   forward, then sets `done_at = now()` anyway — so a recurring task persists
   `done: false` **with** a fresh `done_at`. Nothing here may read `done_at` as
   "is completed". The app therefore checks `repeat_after`/`repeat_mode` before
   the call: a recurring row does not disappear, it shows its next date.
   **It gets no Undo**, because the previous due date is gone and the server
   keeps no history of it; writing back the date we happened to have cached
   would be a plausible invented value, which is the thing D-vocab forbade in
   the parser. The check happens BEFORE the call, not on the response: a
   repeating row must never be struck through even for the length of a round
   trip, or it offers, briefly, exactly the Undo this paragraph refuses.
   The row is also restored if the write's own refetch drops it — advancing a
   task due today to tomorrow takes it out of Today, and the message would
   otherwise vanish in the instant it was earned.

6. **Sidebar counts are invalidated once the write is confirmed**, the way
   `useCreateTask` already does it, rather than being decremented optimistically
   in a second place.

7. **Verified against `pinguino` by `src/api/integration.write.test.ts`**, a new
   file gated on a third variable (`VIKUNJA_TEST_WRITE=1`) so the default test
   run still needs no server. It creates a task carrying a description, a due
   date, a priority and a recurrence, completes it, asserts that **nothing was
   erased** and that the due date advanced, reopens it, and deletes it.
   `src/api/integration.test.ts` keeps its read-only promise unchanged: that
   promise is what makes it safe to run without thinking.

---

### D-adverb — A bare repeat adverb is offered, not applied — **DECIDED 2026-09-15**

§5's Recurrence row accepted a bare trailing adverb, so `report mensilmente` and
`standup daily` became repeating tasks. So did this, silently:

```
disdire il servizio pagato mensilmente  ->  title "disdire il servizio pagato"
                                            repeat_after 2592000, no warning
```

It is a one-off errand whose service is paid monthly: the adverb describes the
service, not the task. Both lines are the same shape — words, then an adverb,
then the end of the line — and the fix that closed the rest of F8 (requiring the
adverb to END the schedule, which removed `a weekly report from the vendor`)
cannot separate them. It was pinned as F8, and the framing then was that it was
irreducible.

**A second opinion (Codex, 2026-09-15) showed that framing was too strong**, and
its counter-examples are worth keeping because each one kills an obvious fix:

| proposed rule | killed by |
|---|---|
| a closed list of punctual verbs | `cancel expired subscriptions monthly` genuinely repeats |
| a determiner+noun object before the adverb | `controllare il saldo mensilmente` has exactly that shape |
| requiring a leading task verb | both lines have one, and `standup daily` has none |
| a billing-participle veto (`pagato`, `billed`) | the strongest candidate, but it loses `get paid monthly` and misses `cancel membership renewed monthly` |

The honest claim is narrower than "irreducible": **intent is not uniquely
recoverable from the line.** So no rule decides it. The user does.

**Decision: the parser REPORTS a bare adverb and does not apply it.** No repeat
is written, the word stays in the title, and the span carries what accepting it
would write (`suggestedRepeat`). The composer offers it as a chip. There is no
warning, because the chip IS the message — a warning would be the parser
apologising for a choice it deliberately did not make.

This is D-vocab's principle one level up. D-vocab says an out-of-grammar phrase
must not silently become a date; D-adverb says an in-grammar phrase whose
MEANING is ambiguous must not silently become a schedule.

An `every`-phrase is unaffected: `every month`, `ogni mese` and `every 2 days`
say what they are and are applied without asking. Only the bare adverb is
offered.

Cost, measured: **4 of the 738 golden records changed**, every one a bare-adverb
line (`I'll leave weekly`, `I'll take a run weekly`, `Andrò via settimanalmente`
twice). Three of the four look like genuine repeats and now take one click. That
is the trade — a click on the common case buys the removal of a silent wrong
answer on the uncommon one.

Not taken, and worth revisiting because it is cheap to measure against the
4325-phrase corpus: the **billing-participle veto**. If it holds up it reduces
how often the offer fires; it does not replace it.

One convention outlived its file. `known-defects.test.ts` pinned a defect as a
test that PASSES while asserting the wrong behaviour, so that a refactor could
not quietly change its shape. Nothing is left to pin, so the file is deleted —
recreate it when the next defect needs it.

### D-toast — Undo toasts, and what stays where it is — **DECIDED 2026-09-16**

D4 step 4, the last of the four interaction slices. The interesting half is
what did NOT move into it.

**The nine inline `role="status"` messages stay where they are.** D-detail put
each beside the field it belongs to because a failed write must not take what
you typed out of sight, and D-write put a completion's message on the ROW so a
self-hosted instance does not feel like it is thinking. Moving either into a
toast would undo a decision that was made by experiment. What was left over is
what the toast region is for: a write that succeeded and took its row off the
screen, and one that failed with no row left to say so on.

So there are exactly two callers, and each replaced something worse:

1. **A failed reorder.** It used to render a `<p>` under the list — the wrong
   place twice over: the list has just snapped back to the old order, and the
   reader may have scrolled away from the row entirely.
2. **A sidebar pick in the task dialog.** Project, date and priority commit on
   pick, with no Save and no Cancel (D-detail, settled by experiment). That is
   the right shape and it is precisely why they need an Undo: there is no
   moment at which the pick can be reconsidered, and two of them can carry the
   task out of the view it was opened from.

**The previous value comes from the server's copy, never from a reconstruction.**
`undoableChange` reads it off the task as it was before the write. This is
D-write's and D-vocab's rule one level up: an invented value presented as one
the user had is worse than no offer.

**The task handed to the Undo is the one this write RETURNED**, not the copy the
closure captured. `updateTask` echoes reminders and assignees off whatever it is
given (its contract, §6 item 13), so undoing with a stale copy would quietly
restore the reminders as they were at the time the dialog opened.

**Clearing a date is naming the column with Vikunja's null date**, not omitting
it — under the bulk route an unnamed column is re-read from the stored row (§6
item 16). So undoing a date ADDED to a task that had none writes
`0001-01-01T00:00:00Z`.

**The toast is refused rather than approximated** when the write names more than
one sidebar field, or names a field with its own way back (`title`,
`description`, `done`). No picker writes two at once, so that can only be a
caller this was not written for, and describing it as one of them would put a
message on screen that does not match what happened.

**Its geometry is NOT measured.** The reconnaissance never captured Todoist's
snackbar, so `docs/layout-specs.md` has no section for it. It is derived from
the nearest measured thing — the confirmation modal of §5, 448 wide, r12 — and
built from tokens. Say so before copying numbers out of it. New tokens:
`--bg-elevated` / `--text-on-elevated` / `--hover-on-elevated` (not "inverse":
in dark the page is already dark, so it lifts rather than flips) and
`--bg-danger` / `--text-on-danger` on the same measured red the p1 and overdue
roles use.

**The unmount guard is the timers, not a flag.** §7 item 9 records what a
"live" boolean did last time: it latched false after StrictMode's remount and
switched the undo window off in `pnpm dev` while a production build stayed fine.
`useToasts` clears its timeouts on unmount and consults nothing.

Verified by driving the app against `pinguino`: picking P3 raised
"Priority set to P3" with an Undo, the Undo put the priority back, the toast
went, and the server showed the description, project and reminders untouched.

### D-order — Drag reorder, and what §3 got wrong — **DECIDED 2026-09-16**

D4 step 3. The owner chose the full scope: project lists, Inbox **and** Today.

**The slice was larger than "add dnd-kit", because the app could not READ an
order, let alone write one.** Every list was a flat `GET /tasks` sorted by due
date, and §3 says a task fetched that way carries `position` 0 — meaningless.
`Task.position`, `Task.bucket_id` and `Project.views` had all been typed since
the foundation slice and read nowhere. So the manual order arranged in Vikunja
or in Veyrn was invisible here.

**Everything rested on a route nobody had called.** §3's route name, midpoint
arithmetic and renumber rule were read off Vikunja's source on `main`, and this
instance has already retired a route between versions (`/tasks/all` → 400). The
slice therefore opened with probes, not code, and they are kept in the two
integration files: §6 items 22-30.

**What the probes changed:**

1. **There is no server-side renumber** (item 23). §3 said a gap below
   `MinPositionSpacing` makes the server rewrite the view. It does not — a
   position written 0.001 from its neighbour was stored verbatim and 0 of 3
   neighbours moved. The recalculation is the FRONTEND's, which is what §3's own
   citation always was. That inverts the consequence: nothing protects a view
   from its gaps converging, so **the client must renumber**, and a client that
   merely re-read would get the same crowded numbers back and halve them again
   until two tasks share a float and the order falls back to id. `useReorderTask`
   spreads the view back out at 2^16, one write per task, then re-reads.
2. **Discovery is free** (item 25): `GET /projects` carries `views[]` inline.
3. **Today's existing saved filter is already ours** (item 26): `/filters/9`
   asks `done = false && due_date < now/d+1d`, character for character what
   `todayView()` builds, and its view returns the same 9 ids as the ad-hoc
   listing (item 30). The adoption question §4 raised is settled by measurement.

**Decisions worth not re-deriving:**

- **`position: 0` and `position: undefined` are not the same thing.** 0 is real —
  §3 gives it to the first task in an empty view — while undefined means "never
  read through a view". The incremental poll is deliberately a flat `GET /tasks`
  (its comment says why), so `carryViewPosition` folds its copies onto the held
  ones: every field from the server, the position from us. A newcomer has the
  field DELETED, not zeroed, and sorts last. Zeroing it would claim the top.
- **The reorder API takes IDS, not indices.** The rendered list is not the cached
  array: the cache also holds sub-tasks, shown under their parent and nowhere
  else, and rows lingering after a completion. It is also more correct — a hidden
  sub-task between two visible rows still occupies the position space, and the
  midpoint must account for it. Verified live: moving a row one place in
  "Personale" stored 16640, the midpoint of a hidden sub-task at 512 and the
  task at 32768.
- **The reorder mutation never invalidates.** A refetch landing before the server
  has the new position renders the OLD order, which reads as the drag being
  refused. It writes the authoritative array itself, and the poll is told to
  stand still while a write is on the wire.
- **`onMutate` cancels AFTER the optimistic write.** The usual recipe cancels
  first, but `cancelQueries` awaits the in-flight fetch — awaiting the network
  before the row moves is the one thing a drag may never do. A test caught it.
- **dnd-kit's `attributes` and `listeners` go on the HANDLE, never the row.**
  They carry their own `role="button"` and `tabIndex=0`, which would collide with
  the row's deliberate `role="button"` and make every row tabbable again — the
  exact defect D4 step 2 removed. Cost, measured by building both ways:
  **+15.3 kB gzip** (115.35 → 130.62 kB).
- **A move stays inside its section.** Once a list is position-ordered, sections
  come from the DUE DATE while order comes from position, so a section's rows are
  not contiguous in the position space. A drag from "Overdue" into today would
  write a correct position and render the row straight back — a gesture that
  visibly does nothing. Crossing means reschedule, which nobody asked for.
- **open-todo does not create the Today filter.** That would put an object in the
  user's Vikunja, visible in Veyrn and the web UI, because they opened a screen.
  No matching filter means no handle, and no explanation of Vikunja's data model.

**What a `/code-review` pass caught afterwards**, all six fixed in one commit
and each pinned by a test that was verified to fail without its fix:

- **Dropping a task at the BOTTOM could send it to the top.** A task the
  incremental poll produced has no position and the comparator parks it at the
  tail, so the last slot's neighbours were both read as "absent",
  `positionBetween` took its empty-list branch and returned **0** — which sorts
  first. The gesture said bottom and the server was told top, with
  `needsRenumber: false` so nothing repaired it. Neighbours are now the nearest
  ones that actually HAVE a position.
- **A tie now reports `needsRenumber` unconditionally.** The 0.01 step places
  the task just BELOW the neighbour it was dropped above, so the requested
  order cannot be expressed until the view is spread out; leaving it to the gap
  arithmetic made the answer depend on magnitude (true at 5, false at 131072 —
  and 131072 is a number the renumber loop itself writes).
- **A failed renumber no longer rolls back a move that succeeded.** The move is
  written before the loop, so a failure inside it used to restore the pre-move
  array and say "Not moved" about a move that had landed, leaving the view
  half-renumbered with nothing to refetch it.
- **The post-renumber re-read carries `filter_timezone`.** Without it Today's
  `now/d+1d` resolved against the server's midnight (GMT here) and that array
  was written into the cache as the truth.
- **One move at a time.** Two overlapping ones are not merely racy: the first,
  if it renumbers, rewrites every position from a snapshot that does not
  contain the second. Alt+Arrow also ignores auto-repeat.
- **`writeBack` carries the position across.** `updateTask` answers through
  `/tasks/bulk`, not a view endpoint, so its copy carries the meaningless 0 —
  renaming a task would float it to the top of a hand-arranged list.

**The defect only driving the app found, and the one to remember:**
`groupTasksForView` identified the view by `view.key === "today"`. The key became
`today@v42` when it started carrying its view id, the comparison silently
stopped matching, and **Today lost its "Overdue" heading while all 713 tests
stayed green**. Grouping is now its own field on `ViewDef`. A key identifies a
cache entry; it does not declare behaviour. Look for the same shape elsewhere.

### D-detail — The task-detail dialog — **DECIDED 2026-09-15**

D4 step 2 shipped a keyboard whose Enter had nowhere to go: `TaskRow.onOpen` had
been declared since the foundation slice, plumbed through `ListView.onOpenTask`,
and never supplied. That unterminated wire had already cost twice (the review's
inert "Reopen" checkbox, and Enter having to mean COMPLETE). The dialog
terminates it. Geometry is `docs/layout-specs.md` §4 at its measured numbers —
864×750, r10, header 48, main 604 / sidebar 260.

**The load-bearing decision: there are TWO commit models, and they are
independent.** Both were measured on the reference product, not guessed.

| Half | Fields | How it commits |
|---|---|---|
| Main column | name, description | opens on click, written **only by Save**; **Cancel is the only discard** |
| Sidebar | project, date, priority, labels, reminders | **picking writes**. No Save, no Cancel |

Settled by experiment before a line was written: open the title editor, type
into it, change the priority, press Cancel. The title reverts; the priority
stays, and survives a reload. So `EditableField` and `PickerField` share no
state and neither closes the other.

`Escape` does **not** discard in the main column — the dialog's own Escape
closes the dialog, so a discarding Escape would throw away the text *and* the
pane it was in. The dialog's key handler ignores Escape while a form control
holds the focus.

**A failed write never eats what you typed**, in either half: the editor stays
open with the draft and the server's reason beneath it (the draft is the only
copy that exists), and a failed pick keeps its picker open, because with no
Save button to stay behind, closing would put the old value back on screen with
nothing to explain it.

**Where the task comes from.** The dialog reads it out of the open view's cached
list, not a query of its own. One source of truth means the 20 s poll keeps an
open dialog current for free and the two existing `queryKey[0] === "tasks"`
invalidations keep working; a private detail key would be invisible to both, so
the row behind the dialog and the dialog itself would disagree after every
write. `useUpdateTask` writes the server's returned task into every cached view
that holds it *before* invalidating, so both change in the same frame.
The one deliberate exception is comments, under `["task", id, "comments"]` —
**not** under `"tasks"`, or completing any task anywhere would refetch every
open thread.

**Decisions inside it worth not re-deriving:**

1. **Descriptions and comments are HTML; this app shows them as one line of
   text.** Saving that text back would silently drop any link, bold or list a
   Veyrn user wrote. `isRichHtml` detects markup that cannot survive the round
   trip and the editor says so **before** the first keystroke;
   `toDescriptionHtml` escapes what is typed and wraps it one paragraph per
   line, inventing no markup the user did not write.
2. **An edited name is parsed the way the composer parses a new one**, and the
   **sidebar is the feedback** — the owner chose it over chips beside the field.
   The rows show what Save would set and say "(when you save)", because a colour
   alone would make the channel invisible to a screen reader. It never names a
   column whose value already matches (naming a column is what makes it written
   — mapping §6 item 13 — so re-writing an unchanged value is a free chance to
   clobber a concurrent edit), never saves a phrase that leaves no name behind,
   and never creates a label. The phrase is re-read with a fresh clock at Save,
   because a preview computed at the last keystroke is a day stale in a tab left
   open overnight.
3. **The date picker's shortcuts are PHRASES, not computed dates**, run through
   `dueDateFromPhrase` — the same acceptor the composer uses, so the button and
   the field under it cannot disagree about what "tomorrow" means. Two
   consequences, both accepted: "This weekend" is not in the grammar, so that
   shortcut sends "saturday"; and a half-understood phrase is **refused**
   rather than half-applied. D-vocab all the way down.
4. **Creating a label is a BUTTON, never a keystroke.** Enter in the filter
   field does nothing on purpose: the label namespace is shared by every task in
   the instance, so a typo committed by typing is not undoable by whoever made
   it. The button names what it will create. And `PUT /labels` accepts a
   duplicate title (§6 item 19), so `canCreateLabel` is the only thing standing
   between an instance and two labels called `urgent`.
5. **A sub-task is shown under its parent and nowhere else.** `ViewDef` gains
   `includes` and `belongs` is *defined* in terms of it, with a test asserting
   `belongs` implies `includes` for every view, so the fetched-list filter and
   the poll's in-view predicate cannot drift. Vikunja's filter language cannot
   express "has no parent", so this is client-side either way.
   `rowContext.tasksById` is still built from the **unfiltered** list, or every
   "1 / 3" badge would under-report its own children. Stated rather than
   discovered later: a child whose parent is not in the view — done, or in
   another project — is visible nowhere. That matches the reference product and
   is the likeliest bug report.
6. **Nothing is painted that cannot be honoured.** The first cut of the dialog
   was read-only and deliberately drew no control it could not yet write;
   editing arrived field by field with the write each one needs. A button that
   does nothing is the defect this app keeps relearning.

**Verified against `pinguino` in the browser, not only in jsdom**, at every
step, and every scratch task, label and comment deleted afterwards. The
server-side findings are `docs/data-model-mapping.md` §6 items 15-21.

**Known gap with the reference product, measured and never decided:** it asks
*"Ignorare le modifiche non salvate?"* before discarding an edit; open-todo's
Cancel just discards.

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
   be triggered from `orca eval`), and the "Prossime" (upcoming) and
   project-with-sections views were not measured. (The accent hue, open when
   this item was written, was picked the same day — item 5.)
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
8. ~~Make a task completable~~ — done 2026-09-15 (D-write in §4). `updateTask`
   and `deleteTask`, the checkbox wired to the first of them, a six-second
   linger with an Undo, and the repeating case reported rather than faked.
   Notes for whoever continues:
   - **`POST /tasks/{id}` erases every field the body omits.** Read off the
     v2.5.0 source and recorded as `docs/data-model-mapping.md` §6 item 13.
     Every future write — inline edit, reschedule, project move — goes through
     `updateTask`, which names its fields. Do not add a second write path
     without reading that row first.
   - `deleteTask` exists with no UI behind it, for the write test's cleanup.
     A delete affordance is its own slice: confirmation, entry point,
     reversibility.
   - `src/api/integration.write.test.ts` is the probe for all of it, behind
     `VIKUNJA_TEST_WRITE=1`. **Run green against `pinguino` (2.5.0) on
     2026-09-15**, so §6 items 13 and 14 are measured and not merely read.
     Re-run it after a server upgrade, the way items 7-12 were re-run.
   - One thing that run corrected, worth not rediscovering: Vikunja stores
     `due_date` to the SECOND, so a date carrying milliseconds comes back
     rounded and an exact comparison fails on noise.
9. ~~D4 slice 2 (keyboard navigation)~~ — done 2026-09-15 (D4 step 2 in §4).
   One tab stop with a roving `tabindex`, the handler on the row rather than the
   scroll container, and Todoist's own key map: Enter opens, `E` completes, `Z`
   undoes, `J`/`K` alias the arrows. The map was corrected inside the same
   session, in the commit that gave Enter a destination.
   One defect from that slice is worth not rediscovering: the review's fix for
   "setState after unmount" left `live` false forever after StrictMode's
   mount/unmount/mount, so **the six-second undo window was dead in `pnpm dev`
   and fine in a production build** — correct where nobody looks, broken where
   the app is actually run. `renderHook` does not reproduce it and the tests
   still cannot catch it; it was found by driving the app, which is written into
   the test file so the next person does not trust the suite here.

10. ~~The task-detail dialog~~ — done 2026-09-15 (D-detail in §4). Twelve
    commits; `git log 5c18a4f..ad9be97` carries the reasoning, the measurements
    and the rejected alternatives, and is the thing to read rather than this
    summary. Notes for whoever continues:
    - **Two commit models, both measured.** Main column (name, description)
      needs an explicit Save and Cancel is the only discard; the sidebar
      (project, date, priority, labels, reminders) **commits on pick**. They are
      independent — a pick made while the name editor is open survives that
      editor's Cancel. See D-detail before touching either.
    - **Every write still goes through `updateTask`**, which names its fields
      via `/tasks/bulk`. The traps measured on the way, each pinned by
      `src/api/integration.write.test.ts`: an **empty `fields` list wipes the
      task** (§6 item 17 — priority, due date and description were zeroed while
      the reminder landed intact, which is what makes it convincing); a saved
      filter arrives in `GET /projects` with a **negative id** and must never be
      offered as a destination (item 15, `isRealProject`); an **absolute
      reminder reads back as `relative_period: 0` with no `relative_to`**, so
      branch on `relative_to` and never on the period (item 18); `PUT /labels`
      **accepts duplicate titles** (item 19); `PUT /tasks/{parent}/relations`
      sets **both sides**, so the inverse must not be written too (item 20).
    - `deleteTask` still has **no UI**. It exists for the write test's cleanup.
      A delete affordance is its own slice: confirmation, entry point,
      reversibility.

11. ~~D4 step 3 (drag reorder)~~ — done 2026-09-16 (D-order in §4). Probes
    first (§6 items 22-30), then view-scoped reading, then the poll made to
    stop undoing the order, then the write, then dnd-kit, then Today on its
    saved filter. Notes for whoever continues:
    - **The renumber is ours, not the server's** (§6 item 23). §3 said
      otherwise and was measured wrong. `useReorderTask` spreads a crowded
      view back out at 2^16 per task; without it the gaps halve forever.
    - **Every list now reads through a view endpoint** when one can be
      resolved, and only that listing carries positions. The incremental poll
      is still flat on purpose, so `carryViewPosition` is what stops an edit
      anywhere from throwing a row to the top of a hand-arranged list.
    - **A key identifies a cache entry; it does not declare behaviour.**
      `groupTasksForView` compared `view.key === "today"`, the key became
      `today@v42`, and Today lost its Overdue heading with the whole suite
      green. Worth grepping for the same shape.
    - Upcoming is untouched. It has a saved filter (-9, `/filters/8`) and
      would take the same treatment, but its day grouping makes a cross-day
      drag a reschedule, which is its own decision.

12. ~~D4 step 4 (general undo / toasts)~~ — done 2026-09-16 (D-toast in §4).
    A toast region bottom-left, with two callers: a failed reorder and a
    sidebar pick's Undo. **D4 is now complete.** Notes for whoever continues:
    - The nine inline `role="status"` messages are NOT candidates for it, and
      neither is the completion row linger. Read D-toast before "consolidating"
      them.
    - The geometry is unmeasured — see D-toast.

13. **Open, ranked.** Nothing here is started.
    1. ~~**The Italian language pack is incomplete**~~ — the three TODOs were
       **stale**, and had been for some time. Measured 2026-09-16: F5, F6 and
       F3 were all already closed in Italian, and so was F7. The comments
       pointed at `known-defects.test.ts`, deleted back in D-adverb. Corrected
       in place, because the note had been believed and repeated long after it
       stopped being true.
       What the measurement DID find, in the same shape the old F6 note
       described, is fixed in the same commit: `ogni giorno da lunedì` — the
       bare preposition, and the way anyone actually says it — produced a
       repeat, a due date nobody asked for, and a title collapsed to `"da"`.
       And behind it, F10: the start-date hint was the one place in the grammar
       whose month alternation carried no word boundary, so `dic` matched
       inside `de-dic-are`.
       **The lesson worth keeping is about the corpus, not the grammar.** All
       738 golden records passed unchanged through both fixes: the corpus has
       never contained a phrase of this shape, which is exactly why the defect
       survived. A green corpus is evidence about what it covers and nothing
       else.
    2. **Three sidebar entries go to the wrong screen.** Measured 2026-09-16:
       `#/upcoming`, `#/search` and `#/labels` — and any unknown route — all
       render **Today**, heading included, because `AppScreen`'s view memo ends
       in `return todayView(...)` with no case for them and `Route` is a bare
       `string`. The sidebar offers them as navigation and they silently take
       you somewhere else. This is the defect D-detail named — "a button that
       does nothing is the defect this app keeps relearning" — one step worse,
       because these do something wrong rather than nothing. Cheapest honest
       fix is to render an explicit "not built yet" view for a route with no
       handler; the real fix is Upcoming, which mapping §4 already specifies
       and whose saved filter (-9, `/filters/8`) already exists on `pinguino`.

    3. **Undo is offered for three writes, not all of them.** A completion has
       the row linger, and the sidebar picks have a toast; a label change, a
       reminder change, an added sub-task and a comment have none. Each is
       reversible — the pattern is `undoableChange`'s — and none is done.
    4. **The participle veto left open by D-adverb** — no rule separates
       `disdire il servizio pagato mensilmente` from `controllare il saldo
       mensilmente`. The decision was to offer, not apply; the veto stays open,
       and it is cheap to measure against the 4325-phrase corpus.
    5. ~~**F7**~~ — measured closed 2026-09-16: `corri ogni 1,5 km` matches no
       recurrence and raises no warning. The later rule about what may follow a
       complete schedule closed it; nobody had re-measured. Mapping §5 updated.
    6. **A delete affordance** (item 10 above).
    7. **Never measured**, from the original recon: hover and focus states, the
       Upcoming view, and a project view with sections (item 3 above).
    8. **The unsaved-changes confirmation** the reference product shows and
       open-todo does not (D-detail, last paragraph).

14. Parallel, off the critical path: the upstream Vikunja PR for `task.*`
    WebSocket events (D6). Start from `pkg/websocket/listener.go` and
    `validEvents` in `connection.go`; the open question is how to resolve the
    recipients of a project-scoped event. Before the OIDC part: add the SPA's
    origin to `cors.origins` on `pinguino` and its URL to the Keycloak client's
    redirect URIs.

---

## 8. Context for whoever picks this up

- The owner runs personal tasks on a self-hosted Vikunja instance; the existing
  Apple client is Veyrn (`Vikunja-Tasks`).
- Recon in this document was done through the Orca browser's `orca eval` against
  a logged-in Todoist tab; that session may no longer exist.
- Never `git push` or open a PR without the owner's explicit go-ahead in the
  current session.
