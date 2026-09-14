# Data-model mapping: Todoist concepts → Vikunja API

Written 2026-09-09 against **Vikunja v2.5.0** (swagger from the reference
instance) and Todoist's Sync API v1 object model as observed in the recon (§2 of
the handover). Todoist is the *interaction* reference; Vikunja is the only store.
Every open-todo feature must resolve to the right-hand column or be dropped.

Legend: **=** direct, **≈** representable with a convention, **✗** no equivalent
(decision recorded), **?** unverified.

---

## 1. Containers

| Todoist | Vikunja | Fit | Notes |
|---|---|---|---|
| Project (`name`, `color`, `parent_id`, `child_order`, `is_favorite`, `is_archived`, `view_style`) | `Project` (`title`, `hex_color`, `parent_project_id`, `position`, `is_favorite`, `is_archived`, `views[]`) | = | Colour is a hex on both sides. `view_style` list/board ↔ which of the project's `views` (`list`, `kanban`, `table`, `gantt`) the UI opens by default: a client preference, not server state. |
| Inbox (special project, `inbox_project`) | The user's default project (`user settings → default_project_id`) | ≈ | Vikunja creates an "Inbox" project on signup and exposes it via the settings endpoint. Quick-add without `#project` goes there. |
| Section (`name`, `project_id`, `section_order`, `is_collapsed`) | `Bucket` in the project's **kanban** view (`title`, `project_view_id`, `position`) | ≈ | Buckets exist per *view*, not per project. Convention: the project's kanban view with `bucket_configuration_mode = manual` is the section store; the list view renders those buckets as section headers. `is_collapsed` becomes client state. A project whose kanban view uses `filter` buckets has no sections. |
| Label (`name`, `color`, `item_order`, `is_favorite`) | `Label` (`title`, `hex_color`) | ≈ | No ordering or favourite on Vikunja; sort alphabetically. Labels are global per user on both sides. |
| Filter (`name`, `query`, `color`, `is_favorite`) | `SavedFilter` (`title`, `filters`, `is_favorite`) + its own `views[]` | ≈ | Different query languages, see §4. Vikunja saved filters have views with **per-view positions**, which is what makes a manually ordered "Today" possible. |
| Workspace / shared project / collaborators | Project shares (`/projects/{id}/users`, `/teams`) | ≈ | Out of scope for v1: single-user self-hosted. Reads of `assignees` are honoured; no sharing UI. |

## 2. Task fields

| Todoist `item` | Vikunja `Task` | Fit | Notes |
|---|---|---|---|
| `content` | `title` | = | Todoist renders markdown links in titles; keep plain text + autolink. |
| `description` | `description` | = | Vikunja stores HTML from its own editor. open-todo writes plain text / minimal HTML; render sanitised. |
| `project_id` | `project_id` | = | Moving between projects = `POST /tasks/{id}` with new `project_id`. Bucket resets. |
| `section_id` | `bucket_id` (only meaningful with a `project_view_id`) | ≈ | Move = `POST /projects/{p}/views/{v}/buckets/{b}/tasks`. Must stay inside one view. |
| `parent_id` (sub-tasks, nested) | `related_tasks` with kind `subtask` / `parenttask` | ≈ | Relation, not a field: `PUT /tasks/{id}/relations`. Nesting depth unlimited on both. The list-row "0 / 3" counter comes from `related_tasks.subtask` (present without `expand`, §6 item 2). |
| `child_order` (order inside section/parent) | `position` **per project view** (`POST /tasks/{id}/position`, body `{project_view_id, position}`) | ≈ | See §3. |
| `day_order` (manual order in Today) | `position` in a **saved-filter view** | ≈ | Only if "Today" is a saved filter (§4). Otherwise client-side and lost on reload. |
| `labels[]` (names) | `labels[]` (objects) via `PUT /tasks/{id}/labels` / `DELETE …/labels/{lid}` | ≈ | Read-only on the task object; write through the sub-resource. `PUT /tasks/{id}/labels/bulk` sets the whole list. |
| `priority` 4 = p1 … 1 = p4 | `priority` 0–5 (Vikunja UI: 1 Low, 2 Medium, 3 High, 4 Urgent, 5 DO NOW) | ≈ | **Convention (D-map-1):** write p1→4, p2→3, p3→2, p4→0. Read 5 and 4 → p1, 3 → p2, 2 and 1 → p3, 0 → p4. Tasks created elsewhere at 5 or 1 stay readable and are not rewritten unless edited. |
| `due.date` (all-day, `YYYY-MM-DD`) | `due_date` (RFC 3339 datetime, no all-day flag) | ≈ | **Convention (D-map-2):** all-day = the user's Vikunja `default_due_time` (2.6+), else 20:00, in the user's timezone; shown date-only when the time equals that default. Matches Veyrn. See §6 item 1. |
| `due.datetime` | `due_date` | = | UTC on the wire, shown in browser zone. |
| `due.string` + `due.is_recurring` (natural language, e.g. "every monday") | `repeat_after` (seconds) + `repeat_mode` (0 after last due, 1 monthly, 2 from completion date) | ≈/✗ | See §5 for the accepted grammar. Anything not in the table is rejected at parse time, never silently approximated. |
| `deadline` (separate from due) | `end_date` | ≈ | Vikunja treats start/end as a span. v1: not surfaced. |
| `duration` | `start_date` + `end_date` | ≈ | v1: not surfaced. |
| `checked` | `done` | = | Completing a recurring task advances `due_date` server-side per `repeat_mode`. |
| `completed_at` | `done_at` | = | Read-only. |
| `added_at` / `updated_at` | `created` / `updated` | = | `updated` drives incremental refresh (§7). |
| `responsible_uid` / `assigned_by_uid` | `assignees[]` | ≈ | Read only in v1. |
| `is_collapsed` (sub-task tree) | ✗ | client state | localStorage. |
| `is_deleted` | `deleted_at` (soft delete, 30-day retention) | = | New in v2.x. Not filterable (§6 item 3): deletions are found by id-set reconciliation. |
| Comments / notes (`content`, `file_attachment`, `posted_at`) | `TaskComment` via `/tasks/{id}/comments`; attachments via `/tasks/{id}/attachments` | = | `comment_count` needs `expand=comment_count`. |
| Reminders (separate resource: absolute `due`, relative `minute_offset`, location) | `reminders[]` inline on the task: `reminder` (absolute) **or** `relative_period` (seconds, negative = before) + `relative_to` ∈ {`due_date`, `start_date`, `end_date`} | = | Location reminders: ✗. "All'orario dell'attività" = `relative_period 0, relative_to due_date`. |
| `is_favorite` (task) | `is_favorite` | = | Vikunja surfaces favourites as a pseudo-project. |
| Karma, stats, completed-task history | ✗ | dropped | Not a feature. |

## 3. Ordering (the part D4 step 3 depends on)

Vikunja positions are **`float64`, stored per `(task, project_view)`** in
`task_positions`. Semantics, verified from `pkg/models/task_position.go` and
`frontend/src/helpers/calculateItemPosition.ts` on `main`:

- A task fetched through a view endpoint (`GET /projects/{id}/views/{view}/tasks`)
  carries that view's `position`; fetched any other way it is `0`.
- Insert between neighbours: `pos = before + (after − before) / 2`.
  No `before`: `after / 2`. No `after`: `before + 2^16`. Empty list: `0`.
- Equal neighbours (conflict): `after + 0.01`.
- `MinPositionSpacing = 0.01`; a write that would fall below it makes the
  **server renumber the whole view**, so the stored value may differ from what
  was sent. Re-read positions after a move rather than trusting the local value.
- Upsert is atomic on `(task_id, project_view_id)`.

Consequences for open-todo:

- Drag reorder = one `POST /tasks/{id}/position` with `{project_view_id, position}`.
  No batch endpoint; a drop that also changes bucket is the bucket move first,
  then the position write.
- The list view and the kanban view of the same project have **independent**
  orders. Convention: open-todo reorders in the **list** view's position space
  and shows sections from the kanban view's buckets; bucket membership and
  list order are therefore stored in two views. Independence of the two
  position spaces is verified read-only (§6 item 5).
- Veyrn does **not** write positions at all (grep of its Swift sources on
  2026-09-09 found no position writes; it sorts client-side by
  `TaskSortOrder`). It is not a reference for this slice.

## 4. Views and filters

| Todoist view | Vikunja realisation | Notes |
|---|---|---|
| Inbox | default project, list view | Sections from its kanban view (§1). |
| Today | Saved filter `done = false && due_date < now/d+1d` with **one list view** | Grouping into "Scadute" / today is client-side (`due_date < now/d`). Persisted manual order via the filter view's positions. `now/d` date-math verified (§6 item 4). |
| Upcoming | Saved filter `done = false && due_date > now/d` grouped by day client-side | Drag between days = due-date change, not a position write. |

**Status in the foundation slice:** Today is issued as an *ad-hoc*
`GET /tasks?filter=…`, not as a SavedFilter. That is enough for a read-only
view, but the saved filter and its view must exist before D4 step 3 — the
per-view `position` that makes a manually ordered Today persist lives on it.
| Project list / board | The project's `list` / `kanban` view | Board columns = buckets. |
| Custom filter (`p1 & #Work`, `today \| overdue`) | `SavedFilter.filters.filter` in Vikunja syntax (`priority = 4 && project = 12`) | **No automatic translation** of Todoist query strings; open-todo's filter editor speaks Vikunja syntax, with a picker UI on top. |
| Labels view (`@label`) | `GET /tasks?filter=labels in [id]` | |
| Completed tasks | `GET /tasks?filter=done = true&sort_by=done_at&order_by=desc` | Per project: add `project = id`. |

## 5. Quick-add grammar (D4 slice 1)

Observed in Todoist (Italian locale) and highlighted inline: relative dates with
time ("domani alle 10"), priority tokens ("p1"), project ("#Personale"). Unknown
labels ("@telefono") stay plain until the label exists.

Vikunja's own grammar (`parseTaskText.ts`, ported by Veyrn's `QuickAddParser.swift`)
uses `*label`, `+project`, `!1`–`!5`. **Decision (D-map-3): open-todo accepts
Todoist's sigils** — `#project`, `@label`, `p1`–`p4` — because that is the
muscle memory being targeted; `!N` and `*label` are also accepted as aliases so
text written for Vikunja's UI still parses.

| Token class | Accepted forms (EN + IT) | Writes |
|---|---|---|
| Project | `#Name` (prefix match, quoted for spaces) | `project_id` |
| Label | `@name`, `*name` (existing labels only; unknown → offer to create) | `labels[]` |
| Priority | `p1`–`p4`, `!1`–`!5` | `priority` per D-map-1 |
| Date | See the enforced table below | `due_date` |
| Time | `at 10`, `alle 10`, `ore 10`, `alle ore 10`, `10:30`, `3pm` — as a suffix on a Date row, never alone | time part of `due_date` |
| Recurrence | `every day/week/month/year`, `daily…yearly`, `quotidianamente` / `giornalmente` / `settimanalmente` / `mensilmente` / `annualmente`, `every N days/weeks/months`, `every other <unit>` / `ogni altro <unit>` (= every 2), `every monday` (single weekday), `every weekday` / `workday` / `working day` / `ogni giorno feriale` / `giorni lavorativi` (approximated as weekly — **flag in UI**), `every <day> <month>` / `ogni <giorno> <mese>` (yearly on a fixed date — see below), `every! …` → `repeat_mode 2` | `repeat_after` + `repeat_mode` |
| Recurrence, **rejected** | `every mon, wed` / `ogni 5,6` (a list of weekdays **or** day numbers), `every 2nd tuesday` / `ogni secondo martedì` / `ogni 2° martedì` (+ optional `of the month` / `del mese`), `every last day of month`, `every workday at 9 starting …` / `ogni giorno a partire da …` (also `a cominciare da`; NOT a bare `da`, which is ordinary Italian) | Shown as "not supported by Vikunja"; text stays in the title. |
| Literal | the **whole** line wrapped in matching `"` or `'` | nothing is parsed; the quoted text becomes the title verbatim |
| Reminder | `!` alone (Todoist's reminder sigil) | not in v1; chip in the composer instead |

**Implementation (D-parser, 2026-09-10).** The Date and Time rows are parsed by
`chrono-node` (`it` and `en` locales), wrapped by the guards listed in
HANDOVER D-parser. The Recurrence rows and every sigil stay hand-written:
`rrule` misreads Italian recurrence as yearly without reporting a failure, and
no library supplies the masking order that keeps `@monday` from becoming a date.

Two grammar notes follow from that wrapper: a bare weekday always means the next
occurrence, never today; and `tonight` / `stasera` set the day only, leaving the
time to the all-day marker in D-map-2.

**Amendment (2026-09-14): a yearly repeat on a fixed date.** `tasse ogni 30
giugno` and `pay tax every 30 june` are now one yearly repeat rather than a
one-off task named `tasse ogni`. Three things make this row unlike the others:

- **It consumes the every-word only.** The date beside it goes on to the Date
  row exactly as if the repeat were not there, so the task keeps the day of the
  year the user typed. Every other accepted recurrence swallows its whole phrase
  and leaves no due date at all; a yearly repeat with nothing to repeat from
  would be no more useful than the one-off it replaces.
- **It is silent about the approximation.** Vikunja's year is `repeat_after =
  365 days`, which moves the task a day earlier after each leap year — early,
  never late. `every year` already carries the identical approximation without a
  warning, and warning on one form but not the other would be incoherent. This
  is the one place §5's "nothing is approximated silently" rule is read as
  "nothing is approximated *differently* from its own synonym".
- **The date must be one the Date row accepts.** `every 30 june 2028` names a
  single year, which contradicts a repeat, and keeps its one-off reading.
  `every april 3rd` carries an ordinal suffix the Date row does not admit, and
  is left to be refused there rather than becoming a repeat with no date.

Todoist stores the same phrase as `FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=2`. Vikunja
has no field for the month and day, so the two agree on the kind, the interval
and the first occurrence, and differ only in the calendar detail Vikunja cannot
hold.

**A rejected repeat must consume the whole phrase (2026-09-14).** Rejecting a
recurrence and then letting the next layer read what is left over is worse than
either alone: the user gets a warning *and* a due date they never typed. Three
rules follow from it, each added after an adversarial pass found the opposite
behaviour shipping:

- Every rejected shape tolerates the `!` form. `every! … starting monday` used
  to slip past all five reject rules, because they required whitespace straight
  after the every-word.
- When more than one rejected shape matches, the **widest** span wins, not the
  first one tested. `pay every 5,6 starting monday` matches both the list rule
  and the starting rule; the list rule masked less and let `starting monday` be
  scheduled.
- A starting clause reaches the **end of the phrase**, stopping only before a
  sigil. It used to cover a bare weekday and nothing else, so
  `ogni giorno a partire dal 15 settembre` warned and then scheduled 15
  September.
- A starting clause must **name a date**. `leggere ogni giorno a partire dalla
  prima pagina` is a daily task that starts at page one, and refusing it lost a
  repeat the user did ask for; the same held in English for
  `review every chapter starting from the second`. The test is the packs' own
  date words — a digit, a weekday, a relative day, a month, or a next-period
  phrase — because `starting next week` carries none of the first four.

**An anchored repeat cannot outlive its date (2026-09-14).** The yearly rule
above takes only the every-word and leaves the date to the Date row. When that
row refuses the date — `every sep 15` reads the 15 as a year, `every 31 june` is
not a day, `every april 3rd` carries an ordinal — the repeat is dropped too, and
the every-word goes back into the title. A yearly task with no due date repeats
from nothing.

**Known limitation of the list rule (2026-09-14).** A list item is a weekday or
a day-of-month number, so `ogni 5,6` is refused like `every mon, wed`. Italian
writes decimals with a comma, so `corri ogni 1,5 km` takes the same refusal and
shows a warning about a repeat the user never wrote. Nothing is lost — the title
is untouched and no date is set — and the alternatives are worse: a space after
the comma does not separate the two cases, and gating on a following unit noun
is guesswork. Zero occurrences in the 4325-record corpus. Pinned as F7 in
`known-defects.test.ts`. A day-of-month is 1 to 31, so
`check every 0 and 1 in the output` is left alone.

**Counter-examples are part of the grammar (2026-09-14).** Each pack carries two
lists, and widening a pattern means adding to them in the same commit.
`negativeCorpus` is text a pack's words would wrongly turn into a date and that
§5 refuses **out loud** — `I sat down with the team` names `sat` in its warning,
because a silent refusal would leave the user hunting for a missing word.
`inertCorpus` is ordinary prose the parser must not react to **at all**: no
date, no repeat, no warning. `controllare ogni fattura prima di pagarla` is a
sentence, not a schedule, and there is nothing to explain.

The second list exists because of a specific failure. Six recurrence fixes each
widened a pattern, each was gated on a zero-diff run over 4325 corpus records,
and each passed — yet nine shipped a false positive on ordinary text. That
corpus is a *date* corpus: it holds almost no prose carrying a recurrence word,
so the gate was blind to exactly what the fixes could break. A gate proves what
did not change; only counter-examples prove what a new rule does not eat.

**Three limitations left open, pinned as F8, F10 and F11 (2026-09-14).** Each is
a pattern matching ordinary prose, and each is a §5 decision rather than a
repair. A repeat adverb is read anywhere in the line, so
`disdire il servizio pagato mensilmente` becomes a monthly task — English has
behaved this way since before the language packs, and narrowing it would break
the bare `daily` / `weekly` forms §5 lists. A month abbreviation is also an
ordinary word: `preparare 3 set di documenti` schedules 3 September and deletes
two words from the title, the same tension as `mar` that §5 already settled by
excluding 3-letter weekdays while keeping 3-letter months. And chrono offers
`the day` inside `the day-care visit`, which §5 correctly refuses and then
explains — `isInstantIdiom` suppresses this class of warning only when chrono is
hour-certain, and `the day` is day-certain, so widening that predicate touches
every silent refusal.

### 5.1 The date table is enforced, not merely documented (D-vocab, 2026-09-10)

chrono carries a far wider vocabulary than this table and cannot be configured
per word. Left alone it reads `sat` in "I sat down with the team" as Saturday,
`mar` in "il mar mosso" as Tuesday, and `Sep 15` as 1 September **2015**. Because
`parse.ts` removes whatever the date layer matched from the title, the user loses
a word *and* gains a due date they never asked for.

So the table below is an **acceptor**: chrono resolves, this table decides what is
admissible. Anything outside it keeps its text in the title, sets no date, and
says why in the composer. Adding a row here is a deliberate grammar amendment and
takes an owner decision, not a bug fix.

Every row is one shape. A row may carry a time clause from the Time row above.

| Shape | EN | IT |
|---|---|---|
| relative day | `today`, `tomorrow` | `oggi`, `domani`, `dopodomani` |
| day part suffix | `tomorrow morning`, `friday afternoon` | `domani sera`, `sabato mattina` |
| tonight | `tonight` | `stasera` |
| weekday, full name | `friday`, `next friday` | `venerdì`, `venerdì prossimo`, `prossimo venerdì` |
| numeric offset | `in N days`/`weeks`/`months` | `tra`/`fra N giorni`/`settimane`/`mesi`, `tra un mese`, `tra una settimana` |
| next period | `next week`, `next month` | `la settimana prossima`, `prossima settimana`, `il mese prossimo` |
| end of month | `end of month` | `fine mese` |
| month + day | `Apr 30`, `30 apr`, `1 jan`, `29 feb` | `15 settembre`, `settembre 15`, `30 dic`, `29 febbraio` |
| month + day + year | `15 sep 2027` | `15 ott 2027` |
| ISO | `2026-09-15` | `2026-09-15` |
| slash, day-first | `15/9`, `13/10` | `15/9`, `13/10` |

Two rules apply on top of the shapes, because a matching shape is not enough:

- **A month name needs a certain day.** chrono reads the trailing number in
  `feb 29` as a *year* and returns 1 February 2029; `Sep 15` likewise returns
  1 September 2015. Both match the "month + day" shape by text alone, so the
  acceptor also requires that chrono marked the `day` component certain.
- **No date in the past.** `yesterday` / `ieri` and the 2015 reading above are
  refused by the same rule. A task is a thing still to do.

**Deliberately excluded**, each verified to resolve today and each removed on
purpose:

| Excluded | Why |
|---|---|
| 3-letter weekdays: `sat`, `mon`, `wed`, `lun`, `mar`, `ven`, `gio`, `sab`, `dom` | Every one is also an ordinary word in one of the two languages. This removes a capability that worked before chrono, and is the single biggest reason D-vocab exists. |
| the month abbreviation `set` (settembre) | **Removed 2026-09-14**, the same trade as the weekdays above and for the same reason: `set` is an ordinary noun in *both* languages, so `preparare 3 set di documenti` and `order 2 set of keys` each lost two words from the title and gained a September date, silently. It costs `15 set 2027`, which Todoist reads and we no longer do; the month + day + year row now reads `15 ott 2027`. The other abbreviations stay — they bite only beside a digit, and `30 mar`, `5 mag`, `4 lug`, `3 gen` are not ordinary phrases the way `3 set` is. The weak cases are pinned rather than argued away. |
| `this Wednesday`, `this weekend`, `weekend`, `fine settimana` | `this Wednesday` currently resolves a week out — the *wrong* date, not merely an undocumented one. |
| `yesterday`, `ieri`, `last friday` | A due date in the past is not a task. |
| `next year` | Nothing useful to schedule; a year is not a due date. |
| `in N hours`, `tra N ore` | Never in §5. Note `ore` is *two* words here: a time preposition in "ore 15", the unit "hours" in "tra 2 ore". Only the first is admitted, and only the first is rewritten before parsing — see the D-parser guard table in the handover. |
| bare month names: `March`, `marzo` | A month without a day is a period, not a date. |
| ranges: `Friday to Monday` | chrono collapses a range to its start, silently discarding the half the user typed. |

**Instant idioms are excluded silently.** `now`, `a sec`, `a second`, `in a
minute` are real chrono matches, but nobody typing them believes they are
setting a due date. Warning on them would train the user to ignore the warning
that protects `sat` and `mar`, so they are dropped with no message. The
predicate is: chrono is certain of an `hour`, is not certain of a `weekday`, and
the matched text holds no digit.

Bare times (`at 10`, `10:30`) are likewise silent, but for a different reason:
they never become date candidates in the first place, so the acceptor never sees
them.

## 6. Verified against `pinguino` (v2.5.0, 2026-09-09) and what stays open

Route note: the task listing is **`GET /tasks`** in v2.5.0 (`/tasks/all` no
longer exists and returns 400). Base path `/api/v1`; the `/api/v2` in the
owner's `vja` config is client-side only.

| # | Item | Result |
|---|---|---|
| 1 | All-day due representation (D-map-2) | **Settled by convention, not invented.** Vikunja 2.6.0 adds a per-user server setting `settings.frontend_settings.default_due_time` (`HH:MM`); Veyrn already reads it (`VikunjaAPI.refreshDefaultDueTimeIfSupported`) and falls back to **20:00** when the server is older or the value unset. open-todo does the same: a date without a time is written at the user's `default_due_time` in the user's `settings.timezone`, else 20:00. On `pinguino` (2.5.0) `frontend_settings` is `null`, so the fallback applies. Display: a task whose time equals the effective default is shown date-only. This keeps two clients on one instance writing identical values. |
| 2 | Sub-task counts for the "0 / 3" badge | **Verified.** `related_tasks` (kinds `subtask`, `parenttask`) is present on every task from plain `GET /tasks` without `expand`; 12 of 47 open tasks carried it. Children are themselves in the listing, so done-counts come from a client-side id lookup. `expand=subtasks` also works (returned 56 vs 47) but is not needed. `comment_count` is **absent** without `expand=comment_count`. |
| 3 | Soft-deleted tasks in an incremental fetch | **Not possible.** `filter=deleted_at > …` → 400 `The task field 'deleted_at' is invalid`. Deletions are detected by reconciling the id set of a full per-view fetch, or by webhooks (item 6). |
| 4 | `now/d` date-math | **Verified.** `due_date < now/d+1d`, `due_date < now+1d` and `updated >= '2026-09-08T00:00:00Z'` all return 200 with results. |
| 5 | Positions independent per view | **Verified read-only.** Project "Personale": list view (id 5) positions `0.2, 8, 128, 256, 512, 32768…` with `bucket_id 0`; kanban view (id 8) positions `1, 16, 128…` inside bucket "To-Do" and `196608…` in "Done". Same tasks, different position spaces. The bucket-move-then-list-order case was not exercised (it writes). |
| 6 | Webhooks as push channel | Dropped with the proxy (D5 revision): a browser cannot receive them. |
| 11 | The user's `settings.timezone` | **Not a display zone.** On `pinguino` it reads `GMT` while the user is in Italy — an install default nobody changed. open-todo therefore renders and filters in the **browser's** zone; honouring the server setting would shift every time by an hour or two, and filtering in one zone while labelling in another can put a task under "Today" that reads as tomorrow. Revisit when writes land: D-map-2's all-day convention needs one zone shared with Veyrn. |
| 12 | `frontend_settings.default_due_time` | **Absent on `pinguino` 2.5.0** (the field is 2.6+), so D-map-2's 20:00 fallback is the live behaviour, matching Veyrn. |
| — | Default project for sigil-less quick-add | **Verified.** `GET /user` → `settings.default_project_id = 1` ("Inbox"). |
| 7 | `filter_timezone` and `filter_include_nulls` | **Verified on `pinguino` 2026-09-09: `filter_timezone` is honoured.** The same Today filter returned 13 tasks with `Europe/Rome` and 15 with `Pacific/Auckland`, so the server really does evaluate `now/d` in the supplied zone. |
| 8 | Do subtask relations carry `done`? | **Verified on `pinguino` 2026-09-09: yes.** All 18 subtask relations returned a boolean `done`, so the "0 / 3" badge is correct even though completed children are excluded by the view's `done = false` filter. Item 2's "children are themselves in the listing" does not hold under that filter, but it does not need to: the relation object carries the flag. Also of note, `related_tasks` was present on 49 of 49 open tasks. |
| 9 | Pagination headers readable from a browser? | **`pinguino` DOES expose them** (`access-control-expose-headers: x-pagination-total-pages, x-pagination-result-count`, checked 2026-09-09), so the truncation bug was latent there rather than active. It is real on any instance that does not: measured in Chrome, 2026-09-09, these headers are readable **only if the server sends `Access-Control-Expose-Headers`**. `x-pagination-total-pages` and `x-pagination-result-count` are not CORS-safelisted, so a cross-origin page reads them as `null` unless the instance names them. Verified both ways against a stand-in: with the header, `totalPages = "1"`; without it, `null`, and the only readable response header is `content-type`. open-todo therefore ends its page walk on a **short page** rather than on the header, so it is correct either way. Confirm what `pinguino` actually sends. |
| 10 | Server clock readable from a browser? | **No.** The `Date` response header is not CORS-safelisted either and read as `null` in the same measurement, so a browser client cannot cheaply learn the server's time. This is why the incremental poll mark cannot simply be corrected against the server clock; see §7. Vikunja's `now` date math is evaluated server-side, so a filter of the form `updated >= now-30s` sidesteps the browser clock entirely — **verified accepted on `pinguino` 2.5.0, 2026-09-09**, and now the default incremental window (`updatedWithinSeconds`). Only a *duration* crosses the wire, and durations stay correct however wrong the browser's clock is. The timestamp form is kept as a fallback. |
## 7. Refresh strategy — decided 2026-09-09 (D6 in the handover)

Vikunja has **no SSE** and its **WebSocket does not carry task events** (verified
on `main` and on `pinguino`, see below), so v1 polls, behind an interface the
WebSocket can replace later.

**What Vikunja offers today.** `GET /api/v1/ws` (also `/api/v2/ws`), present
since 2.3.0 (April 2026); `pinguino` answers `426` to a bare request, i.e. the
endpoint exists. Protocol: first message `{"action":"auth","token":"<jwt>"}`,
then `{"action":"subscribe","event":"<name>"}`; pushes arrive as
`{"event":"…","data":{…}}`. The allowed events (`pkg/websocket/connection.go`,
`validEvents`) are only `notification.created`, `timer.created`,
`timer.updated`, `timer.deleted`. The hub publishes per user
(`PublishForUser`), never per project. The internal bus already emits 19 events
including `task.created`, `task.updated`, `task.deleted`,
`task.comment.created`, `task.relation.created` (list from
`GET /webhooks/events`), but they are wired to HTTP webhooks only.

**v1 design.**

1. `LiveSource` interface with one implementation, `PollingSource`:
   `GET /tasks?filter=updated >= '<last>'` for the open view every 20 s while
   the tab is visible (`document.visibilityState`), paused in background,
   immediate refresh on focus and after every own mutation. Merge by id.
   Deletions: a full fetch of the open view and an id-set diff every N polls
   (§6 item 3 rules out a cheaper path).
2. `notification.created` over the WebSocket as a **wake-up**: on receipt,
   poll immediately. Covers assignments, comments, reminders, overdue; not
   generic edits. ~30 lines on top of the polling source.
3. `WebSocketSource` slot reserved for when upstream carries `task.*`.

**Parallel track (owner's call, 2026-09-09): upstream PR to Vikunja** adding
`task.*` events to the WebSocket with per-project subscription. The work: a
listener per task event resolving the users with access to the project and
publishing through the hub; the delicate part is the authorisation check.
Benefits Veyrn as well. Not on the critical path of any slice.
