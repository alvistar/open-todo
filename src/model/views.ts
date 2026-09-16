import {
  and,
  dueBeforeTomorrow,
  dueFromTomorrow,
  notDone,
  projectIs,
} from "../api/filter";
import type { Task } from "../api/types";
import { dayDifference, parseVikunjaDate } from "./dates";
import { matchesEveryTerm, parseSearchQuery, serverSearchTerm } from "./search";

/**
 * A view is the pair (server query, client predicate). The predicate exists so
 * PollingSource can decide whether a task it just learned about still belongs
 * in the open view without re-running the query — an edit can move a task out
 * of a view as easily as into it.
 */
/**
 * A task with a parent is a sub-task, and is shown under it rather than on its
 * own row. The consequence, named rather than discovered later: a child whose
 * parent is not in the view - done, or in another project - is not visible
 * anywhere. That matches the reference product and is the likeliest surprise.
 */
function hasNoParent(task: Task): boolean {
  return (task.related_tasks?.parenttask?.length ?? 0) === 0;
}

/**
 * Where a view's manual order is stored: the `(project, project_view)` pair
 * that mapping §3's positions hang off.
 *
 * `projectId` is not always a project. A saved filter arrives in
 * `GET /projects` under a negative id (§6 item 15) and its views take position
 * writes like any other (§6 item 24), which is the only reason Today can be
 * ordered by hand at all.
 */
export interface PositionSource {
  projectId: number;
  viewId: number;
}

export interface ViewDef {
  key: string;
  title: string;
  subtitleFor?: (count: number) => string;
  /** Vikunja filter expression. */
  filter: string;
  /**
   * Vikunja's cross-project search term (mapping §8). Escaped by
   * `serverSearchTerm`; absent on every view that is not a search.
   */
  search?: string;
  sortBy: string[];
  orderBy: ("asc" | "desc")[];
  includeNulls: boolean;
  /**
   * True when this view will show the task AT ALL, before any date or project
   * question. Only sub-tasks are excluded: they are shown under their parent
   * and nowhere else, matching the reference product.
   *
   * Separate from `belongs` so the two cannot disagree - `belongs` is defined
   * in terms of it, and a test asserts `belongs` implies `includes`. Vikunja's
   * filter language cannot express "has no parent", so this is client-side
   * either way.
   */
  includes: (task: Task) => boolean;
  /** True when the task belongs to this view right now. */
  belongs: (task: Task, now: Date, timeZone: string) => boolean;
  /** Show the project name on each row (false for a single-project view). */
  showProject: boolean;
  /**
   * How the rows are cut into sections.
   *
   * A field rather than a comparison against `key`, which is what this was
   * until the key had to carry a view id: `key === "today"` silently stopped
   * matching `today@v42`, and Today lost its Overdue heading with nothing
   * failing anywhere. A key identifies a cache entry; it does not declare
   * behaviour.
   */
  grouping: "dueDay" | "everyDueDay" | "none";
  /**
   * Set when the view is read through a view endpoint and can therefore be
   * reordered. Absent means the list is read the flat way, ordered by due
   * date, and offers no drag handle — a missing affordance rather than one
   * that quietly fails to persist.
   */
  positionSource?: PositionSource;
  /**
   * How the cached array is ordered after an incremental merge. Explicit
   * because it now differs per view: the poll used to re-sort everything by
   * due date, which would undo a manual order within one tick.
   */
  compare: (a: Task, b: Task) => number;
}

const taskCount = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

/**
 * Mirrors the server's `sort_by=due_date,id` so a task merged in by the
 * incremental poll lands in its proper place instead of at the bottom.
 *
 * Undated tasks sort last, which is where `filter_include_nulls=true` puts
 * them in the responses observed so far; if an instance disagrees the full
 * fetch every fifth tick restores the server's own order.
 */
export function compareByDueDateThenId(a: Task, b: Task): number {
  const at = parseVikunjaDate(a.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = parseVikunjaDate(b.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return a.id - b.id;
}

/**
 * Orders a list the way the user arranged it (mapping §3).
 *
 * `position` 0 and `position` undefined are deliberately NOT the same thing.
 * 0 is a real position — §3 gives it to the first task in an empty view — while
 * undefined means the task has only ever been seen through a flat `GET /tasks`,
 * where the field is meaningless. Conflating them would send whichever task
 * legitimately sits at 0 to the bottom of its own list, or float every
 * poll-merged task to the top.
 */
export function compareByPositionThenId(a: Task, b: Task): number {
  const ap = a.position ?? Number.POSITIVE_INFINITY;
  const bp = b.position ?? Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  return a.id - b.id;
}

/**
 * The Inbox, or any single project.
 *
 * `viewId` is the project's LIST view (§3). With it the tasks are read through
 * that view, carry its positions and can be reordered; without it nothing
 * changes from before. The two cases key separately on purpose: they read
 * different endpoints and produce differently ordered arrays, so sharing a
 * cache entry would render one through the other for as long as the view id
 * took to resolve.
 */
export function inboxView(projectId: number, viewId?: number): ViewDef {
  return {
    key: viewId === undefined ? `inbox:${projectId}` : `inbox:${projectId}@v${viewId}`,
    title: "Inbox",
    subtitleFor: taskCount,
    filter: and(notDone(), projectIs(projectId)),
    sortBy: ["due_date", "id"],
    orderBy: ["asc", "asc"],
    // Without this, tasks with no due date drop out of a due_date sort.
    includeNulls: true,
    includes: hasNoParent,
    belongs: (task) => hasNoParent(task) && !task.done && task.project_id === projectId,
    showProject: false,
    grouping: "none",
    ...(viewId === undefined
      ? { compare: compareByDueDateThenId }
      : {
          positionSource: { projectId, viewId },
          compare: compareByPositionThenId,
        }),
  };
}

export function projectView(projectId: number, title: string, viewId?: number): ViewDef {
  return {
    ...inboxView(projectId, viewId),
    key:
      viewId === undefined ? `project:${projectId}` : `project:${projectId}@v${viewId}`,
    title,
  };
}

/**
 * Today = overdue plus everything due before tomorrow. `now/d+1d` is Vikunja
 * date math, verified in mapping §6 item 4; the request carries
 * filter_timezone so the server's midnight is the user's.
 *
 * `source` is the saved filter's list view, when the instance has one asking
 * exactly this question (§6 items 24 and 26). With it, Today keeps a manual
 * order like any list; without it the view is read the flat way and offers
 * none, because a query has nowhere to store one (mapping §4).
 */
export function todayView(source?: PositionSource): ViewDef {
  return {
    key: source === undefined ? "today" : `today@v${source.viewId}`,
    title: "Today",
    subtitleFor: taskCount,
    filter: and(notDone(), dueBeforeTomorrow()),
    sortBy: ["due_date", "id"],
    orderBy: ["asc", "asc"],
    includeNulls: false,
    includes: hasNoParent,
    belongs: (task, now, timeZone) => {
      if (!hasNoParent(task)) return false;
      if (task.done) return false;
      const due = parseVikunjaDate(task.due_date);
      if (!due) return false;
      return dayDifference(now, due, timeZone) <= 0;
    },
    showProject: true,
    grouping: "dueDay",
    ...(source === undefined
      ? { compare: compareByDueDateThenId }
      : { positionSource: source, compare: compareByPositionThenId }),
  };
}

/**
 * Upcoming = everything due tomorrow or later, one section per day.
 *
 * The boundary is the same `now/d+1d` Today stops at, written the other way
 * round, so the two views partition the dated tasks: no task is in both, and
 * none falls between them.
 *
 * Like Today it can only hold a manual order if the instance has a saved
 * filter asking this same question (§6 items 24 and 26). Unlike Today its
 * sections are DAYS, so a drag across one is a change of date rather than of
 * order - ListView refuses a cross-section move for exactly that reason, and
 * rescheduling by drag is its own decision, not part of this one.
 */
export function upcomingView(source?: PositionSource): ViewDef {
  return {
    key: source === undefined ? "upcoming" : `upcoming@v${source.viewId}`,
    title: "Upcoming",
    subtitleFor: taskCount,
    filter: and(notDone(), dueFromTomorrow()),
    sortBy: ["due_date", "id"],
    orderBy: ["asc", "asc"],
    // A task with no due date is not upcoming, it is undated - and including
    // nulls here would put every undated task in the view with no day to sit
    // under.
    includeNulls: false,
    includes: hasNoParent,
    belongs: (task, now, timeZone) => {
      if (!hasNoParent(task)) return false;
      if (task.done) return false;
      const due = parseVikunjaDate(task.due_date);
      if (!due) return false;
      return dayDifference(now, due, timeZone) >= 1;
    },
    showProject: true,
    grouping: "everyDueDay",
    ...(source === undefined
      ? { compare: compareByDueDateThenId }
      : { positionSource: source, compare: compareByPositionThenId }),
  };
}

/**
 * A search across every project (mapping §8).
 *
 * Two halves, because one backend cannot do the job alone. The SERVER is asked
 * for the query's longest term through `s=`, which is the most selective; the
 * CLIENT then requires every term, which turns `s=`'s literal-phrase matching
 * into a real order-independent AND ("mini Mac" finds nothing on the server
 * and everything here). Narrowing only — the client cannot invent a task the
 * query never returned.
 *
 * Sub-tasks are INCLUDED here, unlike in every other view. A list shows a
 * child under its parent and nowhere else, which is right for a list; a search
 * that cannot find a task by its own name is simply broken.
 *
 * It has no position space — matches span projects, and positions are per
 * `(task, project_view)` — so it is never reorderable, and due date is the only
 * ordering that means anything (§8.3).
 */
export function searchView(query: string): ViewDef {
  const terms = parseSearchQuery(query);
  const term = serverSearchTerm(terms);
  const matches = (task: Task) => terms.length > 0 && matchesEveryTerm(task, terms);
  return {
    key: `search:${query}`,
    title: "Search",
    subtitleFor: (n) => `${n} ${n === 1 ? "result" : "results"}`,
    filter: notDone(),
    ...(term === null ? {} : { search: term }),
    sortBy: ["due_date", "id"],
    orderBy: ["asc", "asc"],
    // Undated tasks are results too; without this a due-date sort drops them.
    includeNulls: true,
    includes: matches,
    belongs: (task) => matches(task) && !task.done,
    showProject: true,
    grouping: "none",
    compare: compareByDueDateThenId,
  };
}
