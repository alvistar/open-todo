import type { Task } from "../api/types";
import { dayDifference, dayKey, parseVikunjaDate, UI_LOCALE } from "./dates";
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
 * One Upcoming day header, e.g. "17 Sept · Thursday".
 *
 * The Today shape of layout-specs §2.2 with its middle word dropped. Upcoming
 * itself was never measured on the reference product (§7), so this is derived
 * rather than specified - say so before treating it as a measurement.
 */
export function upcomingHeading(
  day: Date,
  timeZone: string,
  locale: string = UI_LOCALE,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(day);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(
    day,
  );
  return `${date} · ${weekday}`;
}

/**
 * Upcoming is one section per calendar day, in the user's zone.
 *
 * Grouped client-side for the same reason Today is: the server query is a
 * single `due_date >= now/d+1d`, and cutting it into days server-side would be
 * one request per day for a view that is mostly empty.
 *
 * A task with no due date cannot appear, since the filter requires one - but
 * the predicate is defensive anyway, because the incremental poll is NOT scoped
 * by the view's filter and hands this whatever changed.
 */
export function groupUpcoming(
  tasks: Task[],
  _now: Date,
  timeZone: string,
  locale: string = UI_LOCALE,
): TaskGroup[] {
  const byDay = new Map<string, { day: Date; tasks: Task[] }>();

  for (const task of tasks) {
    const due = parseVikunjaDate(task.due_date);
    if (!due) continue;
    // Keyed by the day IN THE USER'S ZONE, not by the instant: two tasks an
    // hour apart across midnight in Rome are different days to the reader and
    // would share a key built from the UTC date.
    const key = dayKey(due, timeZone);
    const bucket = byDay.get(key);
    if (bucket) bucket.tasks.push(task);
    else byDay.set(key, { day: due, tasks: [task] });
  }

  return (
    [...byDay.entries()]
      // The server sorts by due date, but the poll merges and a manual order
      // does not: the SECTIONS must be chronological whatever orders the rows
      // inside them.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, { day, tasks: inDay }]) => ({
        key: `day:${key}`,
        title: upcomingHeading(day, timeZone, locale),
        tasks: inDay,
      }))
  );
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
  if (view.grouping === "dueDay") {
    return groupToday(tasks, context.now, context.timeZone);
  }
  if (view.grouping === "everyDueDay") {
    return groupUpcoming(tasks, context.now, context.timeZone);
  }
  return [{ key: view.key, tasks }];
}
