import { and, dueBeforeTomorrow, notDone, projectIs } from "../api/filter";
import type { Task } from "../api/types";
import { dayDifference, parseVikunjaDate } from "./dates";

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

export interface ViewDef {
  key: string;
  title: string;
  subtitleFor?: (count: number) => string;
  /** Vikunja filter expression. */
  filter: string;
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

export function inboxView(projectId: number): ViewDef {
  return {
    key: `inbox:${projectId}`,
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
  };
}

export function projectView(projectId: number, title: string): ViewDef {
  return {
    ...inboxView(projectId),
    key: `project:${projectId}`,
    title,
  };
}

/**
 * Today = overdue plus everything due before tomorrow. `now/d+1d` is Vikunja
 * date math, verified in mapping §6 item 4; the request carries
 * filter_timezone so the server's midnight is the user's.
 */
export function todayView(): ViewDef {
  return {
    key: "today",
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
  };
}
