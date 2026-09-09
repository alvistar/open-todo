import { and, dueBeforeTomorrow, notDone, projectIs } from "../api/filter";
import type { Task } from "../api/types";
import { dayDifference, parseVikunjaDate } from "./dates";

/**
 * A view is the pair (server query, client predicate). The predicate exists so
 * PollingSource can decide whether a task it just learned about still belongs
 * in the open view without re-running the query — an edit can move a task out
 * of a view as easily as into it.
 */
export interface ViewDef {
  key: string;
  title: string;
  subtitleFor?: (count: number) => string;
  /** Vikunja filter expression. */
  filter: string;
  sortBy: string[];
  orderBy: ("asc" | "desc")[];
  includeNulls: boolean;
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
    belongs: (task) => !task.done && task.project_id === projectId,
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
    belongs: (task, now, timeZone) => {
      if (task.done) return false;
      const due = parseVikunjaDate(task.due_date);
      if (!due) return false;
      return dayDifference(now, due, timeZone) <= 0;
    },
    showProject: true,
  };
}
