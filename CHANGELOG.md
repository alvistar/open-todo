# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **You can now tick a task off.** Until this release the app could log in,
  list and create, and nothing else: `TaskRow` had carried an unwired
  `onToggleDone` prop since the foundation slice, so a task could be written
  and never completed. `updateTask` and `deleteTask` are the writes D4 assumed
  already existed. Decision and rationale: `D-write` in `docs/HANDOVER.md`.
  - A completed row stays on screen for about six seconds, struck through,
    with an **Undo** — and the checkbox itself takes it back, since it is
    labelled "Reopen" by then. Every view in this app filters `done = false`
    and there is no Completed view, so without that window a misclick would
    put a task out of reach until you opened Vikunja's own web UI.
  - A **repeating** task is not completed by Vikunja, it is advanced: the
    server sets `done` back to false and moves the dates forward. The row
    therefore stays and reports its next date. It gets no Undo — the previous
    due date is gone and the server keeps no history of it, so undoing could
    only write back a guess.
  - A failed write puts the row back and says why, on the row itself.
  - The write goes through `POST /tasks/bulk` for a single task, which is the
    only v1 path that names the fields it writes. `POST /tasks/{id}` is not a
    patch: it re-applies every omitted field as its zero value, so the obvious
    one-line toggle would have erased each task's description, dates,
    priority, reminders, assignees **and its recurrence**.
  - `src/api/integration.write.test.ts` (new, behind `VIKUNJA_TEST_WRITE=1`)
    checks all of that against a real instance and cleans up after itself.

### Added
- **The task list has a keyboard.** Up and Down move between tasks, Enter
  completes the focused one (or reopens it), and `u` takes back a completion
  while the row is still on screen. The list is now a single Tab stop instead
  of one per row plus one per checkbox — stepping past a fifty-task view used
  to take over a hundred Tab presses, which is keyboard support nobody could
  use. (D4 step 2.)
- **You can drop anything the quick-add parser recognised.** Every chip whose
  value came from your text — the date, the priority, the project, a repeat —
  now carries a ×. Pressing it clears that value and puts the words back into
  the task name, because you are rejecting the reading, not the words. The
  decision follows the line to the save, so what the composer shows is what
  gets created.

### Changed
- **A bare repeat adverb is now offered rather than applied.** `report
  mensilmente` and `standup daily` used to become repeating tasks on sight. So
  did `disdire il servizio pagato mensilmente` — a one-off errand whose service
  is paid monthly — which became a monthly task with the words cut out of its
  name and no warning. The two lines are the same shape and nothing in them
  separates the readings, so the parser now reports the adverb without acting on
  it: no repeat is written, the word stays in the task name, and the composer
  offers it. `every month`, `ogni mese` and `every 2 days` are unaffected —
  they say what they are. Rationale and the rules that were tried and rejected:
  `D-adverb` in `docs/HANDOVER.md`.

### Fixed
- **Six quick-add defects found by a 4325-phrase corpus**, each one silent.
  Every fix is a §5 grammar amendment recorded in `docs/data-model-mapping.md`.
  - `tasse ogni 30 giugno` / `pay tax every 30 june` was ONE task called "tasse
    ogni", due once in 2027. It is now a yearly repeat that keeps the date the
    user typed. The rule consumes the every-word only, unlike every other
    accepted repeat, because a yearly repeat with nothing to repeat from is no
    more useful than the one-off it replaces. Vikunja's year is 365 days — the
    same approximation `every year` already makes, so it is silent for the same
    reason.
  - `ogni secondo martedì` was scheduled for next Tuesday under the title "ogni
    secondo". The ordinal words were English-only, so it matched neither the
    reject list nor the accept list and the date layer read the weekday on its
    own. Now refused and explained, as `every second tuesday` always was.
  - `ogni giorno a partire da lunedì` produced a daily repeat the user did ask
    for, a one-off due date they did not, and a task named "a partire da". The
    starting-word was English-only. Now refused whole. NOT the bare `da`: it is
    the commonest preposition in the language, and "ogni giorno da fare" is an
    ordinary daily task.
  - `ogni 5,6 alle 15` said nothing at all, where `every mon, wed` has always
    been refused and explained. A list item may now be a day number, not only a
    weekday. Nothing was being lost here — the fix is that the composer says
    why nothing happened.
  - `every workday` set nothing where `every weekday` became a weekly repeat
    with the approximation spelled out. Two words for one idea. Italian gains
    the plural and `giorni lavorativi`, and the repeat adverbs it never had:
    `quotidianamente`, `giornalmente`, `settimanalmente`, `mensilmente`,
    `annualmente`.
  - `every other day` / `ogni altro giorno` set nothing. It means every 2 days,
    which Vikunja stores exactly. `every other monday` stays refused — an
    ordinal weekday is calendar-shaped, as `every 2nd monday` already was, and
    `every other workday` / `ogni altro giorno lavorativo` is approximated to
    every 2 weeks with the same warning `every weekday` has always carried.

- **A rejected repeat no longer leaks a date.** `ogni giorno a partire dal 15
  settembre` warned that the repeat was unsupported and then scheduled 15
  September; `pay every 5,6 starting monday` did the same with Monday. Warning
  about a phrase and acting on half of it is worse than either alone. Three
  rules now hold: every rejected shape tolerates the `every!` form, the widest
  matching rejection wins rather than the first one tested, and a starting
  clause reaches the end of the phrase, stopping only before a sigil so a
  `#project` the user did name still gets through.

- **A repeat that names the day it repeats on cannot outlive that day.**
  `pay tax every sep 15` stored a yearly repeat with no due date, because §5.1
  reads the 15 as a year and refuses it. `every 31 june` did the same with no
  warning at all. The repeat is now dropped with the date, and the every-word
  returns to the title.

  A `starting` clause must now name a date, so `leggere ogni giorno a partire
  dalla prima pagina` keeps the daily repeat it always deserved, and
  `review every chapter starting from the second` is left alone — an English
  hole that predates the language packs.

- **A schedule ends the line, and ordinary prose is left alone.** Four patterns
  were reacting to sentences rather than to schedules:
  - `corri ogni 1,5 km` warned about a repeat, because Italian writes decimals
    with the comma the day-number list reads as a separator. A day list is now
    required to be the end of the schedule — followed by a clock time, a sigil,
    or nothing. A distance is followed by its unit.
  - `a weekly report from the vendor` and `the medicine is taken daily by the
    patient` became repeating tasks. The same rule applies to the bare adverb
    §5 accepts: `standup daily` and `standup daily at 9` still work, because
    nothing but a time follows them.
  - `book the day-care visit` explained a refusal nobody asked for: chrono reads
    `the day` out of `day-care`, §5 refuses it, and the refusal was spoken. A
    span that is only a bare unit noun is now refused in silence. `the day after
    tomorrow` still warns, and so do `sat` and `mar` — those two warnings are
    the whole reason D-vocab exists.
  - **`set` has left the month vocabulary.** It is settembre and it is also the
    ordinary noun in both languages, so `preparare 3 set di documenti` and
    `order 2 set of keys` each lost two words from the title and gained a
    September date, silently. The same trade §5.1 already made for the 3-letter
    weekdays, and it costs the same thing: `15 set 2027` no longer resolves, and
    the month + day + year row now reads `15 ott 2027`.

  One limitation is left, pinned as F8: an adverb that ENDS the line is read as
  a schedule whatever it modifies, so `disdire il servizio pagato mensilmente`
  becomes a monthly task. It is the same shape as `report mensilmente`, which is
  exactly what the user means, and no syntax separates them. Fixing it means
  withdrawing the bare-adverb row from §5, which is a grammar amendment.

- **Each language pack carries its counter-examples, and they are enforced.**
  `negativeCorpus` is text §5 refuses out loud; `inertCorpus` is ordinary prose
  the parser must not react to at all. Every entry runs through the whole
  registry and the whole parser, both layers. The second list is new: the
  recurrence layer had no counter-examples of any kind, which is how a set of
  pattern widenings gated on 4325 corpus records still shipped false positives
  on ordinary sentences. A gate proves what did not change; only
  counter-examples prove what a new rule does not eat.

- `#project` no longer matches inside another word: `close issue#3` stays a
  plain title instead of resolving a project. `#` was the only sigil without
  the lookbehind that `@label` and `p1` already used.

### Changed
- **The quick-add parser now has a concept of "a language".** Italian and
  English words were inlined across five files and the union type `"it" | "en"`
  turned a third language into a compile error in five more. Each language is
  now one file under `src/model/quickadd/lang/`, and adding one needs no engine
  change. A pack contributes WORDS; the engine owns the SHAPE of each §5.1 row.
  That split is not the obvious design and it is load-bearing: §5's shapes are
  bilingual, so `next venerdì` and `prossimo friday` both resolve because the
  prefixes and the weekday names cross. Per-pack finished fragments would have
  dropped every mixed combination in silence.

  A pack's date vocabulary NARROWS what its resolver produced; it never creates
  matches. §5 is an acceptor over chrono's output, so a date word the resolver
  does not know is dead on arrival. Recurrence and the native phrases are ours
  end to end and do take invented words.

  Still Italian and English only. A test-only fixture pack proves the seam
  without adding a language or its corpus maintenance, and it earned its place
  immediately by finding a real bug: two grammar rows read the weekday and
  month names from the shipping registry instead of the pack passed in, so
  compiling a grammar for any other pack list silently carried production's
  lists. Nothing testing the two shipping languages could have surfaced it.

  Every stage was gated on a zero-diff run over all 4325 corpus records at both
  parser layers. The refactor itself changed nothing; the six fixes above moved
  18 rows, every one enumerated in its commit message.

- **`ore` is taught to chrono instead of rewritten around it.** The old path
  rewrote the user's text before parsing and carried an offset map back to the
  original coordinates — 57 lines reinventing chrono's own `parsers` and
  `refiners` arrays. Two overrides replace it, identified by a regex source
  literal rather than a class name, because the production bundle is minified
  and `constructor.name` is `""` there. A count canary fails loudly if a chrono
  upgrade changes how many parts match.

- **A committed 738-record golden corpus** (`__fixtures__/corpus.golden.jsonl`)
  replays the whole parser through vitest, so a behaviour change fails in CI
  and bisects. Drawn from Microsoft Recognizers-Text (MIT), Duckling (BSD-3)
  and chrono (MIT), with attribution in `THIRD_PARTY_NOTICES.md`. Nothing
  Todoist-derived enters the repo — see HANDOVER §6.

- **Quick-add dates and times are parsed by `chrono-node`** (D-parser). The
  hand-written date matchers are gone; recurrence and the sigils are unchanged.
  Costs 16.1 kB gzip and brings both an Italian and an English locale, proper
  refusal of impossible dates, and `tomorrow at 10:30` read as one phrase.
  Guarded against three ways chrono is confidently wrong — `Apr 30` read as the
  year 2030, a bare weekday resolved to today, and a stray number read as a
  clock time. Deliberate change: `tonight` / `stasera` now set the day only.
- **The quick-add date grammar is enforced, not just documented** (D-vocab).
  `docs/data-model-mapping.md` §5 always described the date vocabulary as a
  closed list; adopting chrono quietly made that a claim nobody was checking,
  because chrono carries a far wider vocabulary and cannot be configured per
  word. Since the parser removes whatever matched from the title, the user lost
  a word *and* gained a date they never asked for: `I sat down with the team`
  became "I down with the team" due Saturday, `Sep 15` resolved to 1 September
  **2015**. §5 is now a row-per-shape bilingual table and the code is a
  transcription of it. Anything outside it keeps its text in the title, sets no
  date, and says why in the composer — the treatment rejected recurrence has
  had since the parser was written. `scripts/quickadd-corpus-diff.mjs` measures
  the change: 37 of 98 phrases — 35 forms withdrawn, none of them a §5 row,
  plus the two leap-day phrasings below that now work and did not before.
- **Deliberately removed**: 3-letter weekdays (`sat`, `mon`, `wed`, `lun`,
  `ven`, `gio`, `sab`, `dom` — each also an ordinary word in one of the two
  languages, and the biggest real cost here), `this Wednesday` (which set the
  *wrong* date, a week out), `weekend` / `this weekend` / `fine settimana`,
  `yesterday` / `ieri` / `last friday`, `next year`, `in N hours` / `tra N ore`
  (which the two locales did not even agree on), bare month names, and ranges
  like `Friday to Monday` (which chrono collapses to its start). chrono's
  instant idioms — `now`, `a sec`, `in a minute` — are dropped silently, since
  warning on them would train the user to ignore the warning that protects
  `sat`.
- **`ore 15` now sets a time, like `alle 15`.** chrono's Italian parser knows
  `alle` and not `ore`, so "dentista domenica ore 15" came back as Sunday with
  no time and left "ore 15" in the task name. chrono is now taught the word
  through its own extension points rather than by rewriting the user's text
  before it — see below. "tra 2 ore" is untouched: there the same word is the
  unit "hours", which §5 excludes and which must keep being recognised so its
  warning still explains itself. `alle ore 15`, the most formal Italian
  phrasing, reads as one time. Reported from real use.
- **A leap day now resolves wherever it sits in the line.** The retry appended
  the year to the whole string and required the match to reach the end of it,
  so `party 29 feb` worked while `29 feb party` and `party 29 feb please`
  silently produced nothing.
- **`chrono-node` is pinned exactly.** Which words become a due date is
  application behaviour here, and a caret range let a minor upgrade change it.

### Added
- **MIT licence** — `LICENSE` at the repo root and a `license` field in
  `package.json`. The repo had none, so nothing in it was legally reusable.
- **Quoting the whole quick-add line turns the grammar off**: `"Buy milk
  tomorrow"` creates a task with exactly that name and no due date. No amount
  of grammar can tell that task from the same words meaning a date, so the user
  needs a way to say which they mean. Vikunja's behaviour, reimplemented — it
  is AGPL and open-todo is MIT, so nothing was copied. Requiring the *whole*
  line keeps it clear of `#"Casa e giardino"`.
- **Foundation slice**: a static React + Vite SPA that talks to a self-hosted
  Vikunja directly from the browser, with no proxy.
  - Server setup and login: probes `/info` and shows the server version, then
    accepts either username/password (with an authenticator field when the
    server asks) or a pasted API token. Logging out clears the credential and
    keeps the server URL.
  - Vikunja API client: typed errors, pagination, and the filter builders for
    the forms verified in `docs/data-model-mapping.md` §6.
  - Read-only Inbox, Today and project views at the layout measured in
    `docs/layout-specs.md`, with hash routing and sidebar counts.
  - Live refresh (D6): `PollingSource` behind a `LiveSource` interface — a
    20-second incremental poll while the tab is visible, a full fetch every
    fifth tick to catch deletions, and an immediate refresh on focus.
  - Theme tokens in light and dark with open-todo's teal accent (D3), an
    original icon set, and a theme toggle that respects the system setting.
- `DESIGN.md` — the design system in the open DESIGN.md format (tokens in front
  matter, the eight canonical sections, Motion and a Decisions Log), so gstack's
  design skills and impeccable read the same file. Its token block is generated
  from `src/theme/tokens.css` by `scripts/sync-design-tokens.mjs` and `pnpm
  check` fails on drift, so the design doc cannot quietly disagree with the
  shipped stylesheet.
- `VERSION` is the single source of truth: `scripts/sync-version.mjs` derives
  `package.json` from it and the build fails on drift.
- Handover document (`docs/HANDOVER.md`) stating the project's purpose, the
  findings of the Todoist reconnaissance pass, the open decisions, and the
  legal boundaries on reuse.
- `CLAUDE.md` and a "read this first" section in the handover, so a session
  started cold from this repo knows what is decided, what is open, and how the
  owner wants decisions presented.
- `research/todoist-tokens-light.json` and `research/todoist-tokens-dark.json` —
  CSS custom properties captured from the live Todoist web app, as reference
  material for deriving an original palette.
- `docs/layout-specs.md` — numeric layout specification measured from the live
  product, plus `research/measure-dom.js` to reproduce it.
- `docs/data-model-mapping.md` — the Todoist to Vikunja mapping, the priority
  and all-day conventions, and the refresh strategy.

### Added (quick-add, D4 slice 1)
- Quick-add with natural-language parsing, in English and Italian: `#project`,
  `@label` / `*label`, `p1`-`p4`, `!1`-`!5`, dates, times and recurrence, per
  D-map-3. Opened from the affordance under the list, the sidebar button, or
  the `a` key.
- Task creation, so the app is no longer read-only, including labels and
  recurrence. The list reconciles immediately rather than waiting for a poll.
- Recognised text is highlighted inline as you type, and the composer's chips
  show what the phrase resolved to.
- A recurrence Vikunja cannot express is reported and left in the task name
  rather than approximated, and it is not re-read as a one-off date either.
- Discarding a composer with text in it asks for confirmation.

### Fixed (quick-add review)
- `every 2 months` and every other English "every N months" phrase was
  rejected as unsupported: the weekday list's bare `mon` matched the start of
  `month` in an unanchored reject pattern, killing a whole accepted grammar row
  and telling the user Vikunja could not do something it does.
- An unsupported recurrence could still become a silent one-off due date —
  `every second tuesday`, `every other monday` were not rejected at all, and the
  `… starting monday` rejection stopped short of the weekday, which the date
  matcher then read. Both are the exact failure the rejection exists to prevent.
- `@monday` and `#Lunedi` were eaten from the inside by the date matcher,
  leaving a bare sigil in the task name and inventing a due date. Sigils are now
  extracted before dates, and an unrecognised one is hidden from later matchers
  while staying visible in the title.
- `bob@work.com` donated a `work` label to the task and lost the address.
- Impossible dates rolled over into confident wrong ones: `2026-13-45` became
  14 Feb 2027, `31/2` became 3 Mar. They are refused now, and `29 feb` lands on
  the next leap year instead of 1 March.
- The title kept a dangling `at` / `alle` whenever the time was written as a
  clock face or with am/pm.
- Relative dates were a day early in timezones whose DST changeover skips
  midnight (America/Havana, Santiago, Asuncion).
- Text typed while a create was in flight was wiped when the request returned.
- Discarding during a create told the user the text was lost while the task was
  created anyway, and a create that failed after the composer closed was
  entirely silent.
- Two Enters in the same turn could create the task twice.
- A label that failed to attach was swallowed; it is now reported.
- The confirmation dialog re-took focus on every parent render — including the
  20s poll tick — so focus jumped from "Keep editing" back to "Discard".
- The highlight overlay drifted from the text once it wrapped or exceeded one
  line, and painted over the toolbar. The composer grows with its content now.

### Verified against a live Vikunja 2.5.0 (2026-09-09)
- Quick-add end to end: "… domani alle 9 #Lavoro p2" created a task whose
  stored fields were exactly the parse — a clean title with the sigils removed,
  `due_date` at 09:00 in the user's zone, `priority: 3` for p2 per D-map-1, and
  the named project. A task due today appeared in the list within 2 seconds
  rather than on the next poll tick, sorted into place by due date.
- `updated >= now-30s` is accepted, so the incremental poll window is now
  evaluated by the server and the browser clock is out of the loop entirely.
- `filter_timezone` is honoured (13 tasks for `Europe/Rome` against 15 for
  `Pacific/Auckland` on the same filter).
- Subtask relations carry a boolean `done`, so the "0 / N" badge is correct;
  `related_tasks` was present on all 49 open tasks without `expand`.
- The instance exposes the pagination headers, so the truncation bug fixed
  below was latent there rather than active — it remains real for any instance
  that does not send `Access-Control-Expose-Headers`.
- `frontend_settings.default_due_time` is absent on 2.5.0, so D-map-2's 20:00
  fallback is the live behaviour.
- The rendered app was driven against the live instance: geometry matches the
  spec with real content (toolbar 56, title tier 84, rows 59 and 79, sidebar
  280, column 800, no horizontal overflow), the incremental poll really does
  send `updated >= now-<n>s` with the browser's timezone, D-map-1 maps a stored
  priority of 3 to P2 on screen, and a task created externally appeared within
  one 20s interval, sorted into its place by due date, while a deletion cleared
  within ~40s on the next full fetch.

### Fixed
- The page walk ended on the `x-pagination-total-pages` header, which a
  cross-origin browser cannot read unless the instance sends
  `Access-Control-Expose-Headers` — measured, and the deployment model is
  cross-origin by design. Every collection silently truncated to 50 items, and
  a truncated *full* fetch made the polling diff report the missing tasks as
  deletions. The walk now ends on a short page and is correct either way.
- The incremental poll mark was the browser's clock compared against the
  server's `updated`, so a clock even a minute fast killed incremental
  refresh outright and silently. It is now derived from server timestamps.
- A `refreshNow()` arriving while a tick was in flight was dropped; it is now
  queued. A failed full fetch lost its turn in the cadence, delaying deletion
  detection; it is now retried.
- A 401 from an anonymous request (`/info`, `/login`) cleared the stored
  credential, which behind an authenticating proxy would log the user out for
  an unrelated reason.
- A scoped API token that may read tasks but not `/user` was rejected at login,
  contradicting the query layer, which already tolerates `/user` failing.
- Tasks merged in by the poll were appended rather than sorted, so a task
  created or rescheduled elsewhere sat at the bottom of the list.
- Sidebar Inbox and Today counts never refetched while another view was open.
- `stop()` discarded subscribers, leaving a later `start()` deaf.
- Times were rendered in Vikunja's `settings.timezone`, which on the reference
  instance is an untouched `GMT` while the user is in Italy — every displayed
  time would have been an hour or two out, and filtering in one zone while
  labelling in another can show a task under "Today" that reads as tomorrow.
  The browser's zone is now used for both.

### Decided
- D1 (platform): open-todo is a **web app** in this repository, targeting
  self-hosted Vikunja. Apple platforms stay with Veyrn (`Vikunja-Tasks`).
- D3 (brand): own accent — teal — and an original icon set; the name stays.
- D4: interaction slices in the order quick-add, keyboard, drag reorder, undo.
- D5 (stack): React + Vite static SPA calling Vikunja directly. No proxy.
- D6 (refresh): poll behind a `LiveSource` interface; an upstream PR for
  WebSocket task events runs in parallel, off the critical path.

### Known gaps
- Read-only: no task creation, editing, completion or reordering yet. The
  checkboxes render priority but do not toggle.
- The TOTP error shape has not been seen against a real TOTP-enabled account;
  detection matches Vikunja's error code 1017 and the message text, and
  degrades to "wrong username or password" rather than to a stuck prompt.
- No token refresh: Vikunja 2.5.0 offers none, so an expired JWT returns the
  user to the login screen.
- UI strings and dates are English only; `UI_LOCALE` is the single place i18n
  will change.
- `GET /tasks` returns `position = 0`, so ordering is by due date. The drag
  slice will move to the view-scoped endpoint (`docs/data-model-mapping.md` §3).
- Deletions are found by reconciling the id set of a full fetch, because
  `deleted_at` is not filterable; a deletion can take up to five poll
  intervals to appear.
- Editing is still missing: tasks can be created but not renamed, completed,
  rescheduled or reordered. The checkboxes render priority but do not toggle.
- Quick-add cannot create a label that does not exist yet; an unknown `@label`
  stays in the task name, as it does in Todoist.
