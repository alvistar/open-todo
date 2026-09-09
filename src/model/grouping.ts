import type { Task } from "../api/types";
import { dayDifference, parseVikunjaDate, UI_LOCALE } from "./dates";
import type { RowContext } from "./taskRow";
import type { ViewDef } from "./views";

export interface TaskGroup {
  key: string;
  /** Undefined for a single unlabelled section (Inbox). */
  title?: string;
  tasks: Task[];
}

/**
 * The Today header, e.g. "9 Sep · Today · Wednesday" (layout-specs §2.2).
 */
export function todayHeading(
  now: Date,
  timeZone: string,
  locale: string = UI_LOCALE,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(now);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(
    now,
  );
  return `${date} · Today · ${weekday}`;
}

/**
 * Today splits client-side into overdue and the rest, which is why the server
 * query is a single `due_date < now/d+1d` rather than two round trips.
 */
export function groupToday(
  tasks: Task[],
  now: Date,
  timeZone: string,
  locale: string = UI_LOCALE,
): TaskGroup[] {
  const overdue: Task[] = [];
  const today: Task[] = [];

  for (const task of tasks) {
    const due = parseVikunjaDate(task.due_date);
    if (due && dayDifference(now, due, timeZone) < 0) overdue.push(task);
    else today.push(task);
  }

  const groups: TaskGroup[] = [];
  if (overdue.length > 0)
    groups.push({ key: "overdue", title: "Overdue", tasks: overdue });
  if (today.length > 0 || overdue.length === 0) {
    groups.push({
      key: "today",
      title: todayHeading(now, timeZone, locale),
      tasks: today,
    });
  }
  return groups;
}

export function groupTasksForView(
  view: ViewDef,
  tasks: Task[],
  context: Pick<RowContext, "now" | "timeZone">,
): TaskGroup[] {
  if (view.key === "today") {
    return groupToday(tasks, context.now, context.timeZone);
  }
  return [{ key: view.key, tasks }];
}
