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
| Date | today/oggi, tomorrow/domani, tonight/stasera, weekday names (+ next/prossimo), `in N days/weeks/months` (`tra N giorni…`), `next week/month`, `end of month`, `Apr 30` / `30 apr`, ISO `2026-09-15`, `15/9` (only when unambiguous) | `due_date` |
| Time | `alle 10`, `at 10`, `10:30`, `3pm` | time part of `due_date` |
| Recurrence | `every day/week/month/year`, `daily…yearly`, `every N days/weeks/months`, `every monday` (single weekday), `every weekday` (approximated as weekly — **flag in UI**), `every! …` → `repeat_mode 2` | `repeat_after` + `repeat_mode` |
| Recurrence, **rejected** | `every mon, wed`, `every 2nd tuesday`, `every last day of month`, `every workday at 9 starting …` | Shown as "not supported by Vikunja"; text stays in the title. |
| Reminder | `!` alone (Todoist's reminder sigil) | not in v1; chip in the composer instead |

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
| 6 | Webhooks as push channel | Not tested. `/projects/{id}/webhooks` exists in the swagger. Revisit when the proxy exists. |
| — | Default project for sigil-less quick-add | **Verified.** `GET /user` → `settings.default_project_id = 1` ("Inbox"). |

## 7. Refresh strategy (no `sync_token`)

Poll `GET /tasks?filter=updated >= '<last>'` per open view (verified to work),
plus `GET /projects` and `GET /labels` on window focus. Merge by id. Deletions:
a periodic full fetch of the open view and an id-set diff (item 3 rules out a
cheaper path). The proxy (D5) can hold one poller per session and fan out over
SSE later; v1 polls from the browser through the proxy.
