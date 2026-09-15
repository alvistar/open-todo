import type { Task } from "../api/types";

/*
 * The one piece of list state that does not come from the server (D-write).
 *
 * Completing a task removes it from every view this app has: all of them filter
 * `done = false` on the server and in `ViewDef.belongs`, and there is no
 * "Completed" view. A misclick would therefore put a task out of reach until
 * the user opened Vikunja's own web UI. So a completed row lingers for a few
 * seconds with an Undo before it goes.
 *
 * Because it is not server truth it is deliberately short-lived: it expires on
 * a timer and is dropped on navigation. Nothing here is persisted.
 */

export type PendingKind =
  /** Written as done; still drawn, struck through, with an Undo. */
  | "completed"
  /** A repeating task the server moved forward instead of completing. */
  | "advanced"
  /** The write failed; the row is back as it was and says why. */
  | "failed";

export interface PendingRow {
  /**
   * The task as it was when the user acted. Kept whole because the poller can
   * drop it from the cached view mid-linger, and the row still has to draw.
   */
  task: Task;
  kind: PendingKind;
  /** Where the row sat when the user acted. */
  index: number;
  /** Shown on the row for `advanced` and `failed`. */
  message?: string;
}

export type PendingRows = ReadonlyMap<number, PendingRow>;

/**
 * Overlays the pending rows on a view's tasks.
 *
 * Only `completed` changes the list: it marks the task done so the checkbox
 * fills immediately, and puts the row back if the poller has already removed
 * it. `advanced` and `failed` leave the server's copy alone - their whole
 * effect is a message on the row, which the view model attaches.
 */
export function applyPending(tasks: Task[], pending: PendingRows): Task[] {
  if (pending.size === 0) return tasks;

  let changed = false;
  const result = tasks.map((task) => {
    if (pending.get(task.id)?.kind !== "completed") return task;
    changed = true;
    return { ...task, done: true };
  });

  const present = new Set(tasks.map((task) => task.id));
  // Oldest first, so two rows completed in a row land in a stable order.
  const missing = [...pending.values()]
    .filter((row) => row.kind === "completed" && !present.has(row.task.id))
    .sort((a, b) => a.index - b.index);

  for (const row of missing) {
    result.splice(Math.min(row.index, result.length), 0, { ...row.task, done: true });
    changed = true;
  }

  return changed ? result : tasks;
}

/**
 * True when Vikunja will ADVANCE this task instead of completing it.
 *
 * `Task.isRepeating()` in the server is `repeat_after > 0 || repeat_mode ==
 * Month`: the monthly mode ignores repeat_after entirely, so a task can repeat
 * with an interval of zero. Getting this wrong means the row disappears and
 * then comes back when the poll catches up.
 */
export function isRepeating(task: Pick<Task, "repeat_after" | "repeat_mode">): boolean {
  return (task.repeat_after ?? 0) > 0 || task.repeat_mode === 1;
}
