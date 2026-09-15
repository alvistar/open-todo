import type { Task, TaskReminder } from "../api/types";
import { formatDueLabel, parseVikunjaDate } from "./dates";

/**
 * Reminders, which Vikunja stores in two different shapes.
 *
 * An ABSOLUTE reminder carries `reminder`, an RFC 3339 instant. A RELATIVE one
 * carries `relative_period` in seconds and `relative_to`, the column it counts
 * from - so a relative reminder on a task with no due date is anchored to
 * nothing and never fires. `canRemindRelatively` is what stops the UI offering
 * one.
 *
 * Writing them is the one thing `updateTask`'s `fields` list cannot do:
 * Vikunja handles reminders OUTSIDE that guard (mapping §6 item 13), deleting
 * every row and re-inserting the payload's. They therefore travel through
 * `TaskOverrides`, and the list passed there is the WHOLE new set.
 */

export interface ReminderPreset {
  label: string;
  /** Offset from the due date. 0 is "when it is due"; negative is before. */
  seconds: number;
}

/** The set Todoist offers under "Prima dell'attività", measured 2026-09-15. */
export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { label: "When it is due", seconds: 0 },
  { label: "10 minutes before", seconds: -600 },
  { label: "1 hour before", seconds: -3600 },
  { label: "1 day before", seconds: -86_400 },
];

export function relativeReminder(seconds: number): TaskReminder {
  return { relative_period: seconds, relative_to: "due_date" };
}

/** A relative reminder counts from the due date, so it needs one to exist. */
export function canRemindRelatively(task: Task): boolean {
  return parseVikunjaDate(task.due_date) !== null;
}

/** "10 minutes", "1 hour", "2 days" - the largest unit that divides exactly. */
function duration(seconds: number): string {
  const units: [number, string][] = [
    [86_400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${name}${count === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function describeReminder(
  reminder: TaskReminder,
  now: Date,
  timeZone: string,
  defaultDueTime: string | null,
): string {
  const period = reminder.relative_period;
  if (typeof period === "number" && reminder.relative_to) {
    if (period === 0) return "When it is due";
    return period < 0
      ? `${duration(-period)} before it is due`
      : `${duration(period)} after it is due`;
  }

  const at = parseVikunjaDate(reminder.reminder);
  if (at) return formatDueLabel(at, now, timeZone, defaultDueTime);

  // Neither shape read: say so rather than render an empty row that looks like
  // a bug in the list above it.
  return "A reminder";
}
