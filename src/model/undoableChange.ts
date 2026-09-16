import type { TaskPatch } from "../api/endpoints";
import { type Task, type TaskReminder, VIKUNJA_NULL_DATE } from "../api/types";
import { priorityFromVikunja, priorityLabel } from "./priority";

/**
 * What to say about a sidebar pick, and what to write to take it back.
 *
 * The dialog's sidebar commits on pick — no Save, no Cancel (D-detail). That
 * shape was measured on the reference product and is right, and it is exactly
 * why these writes need an Undo: there is no moment at which the pick can be
 * reconsidered, and two of them can carry the task out of the view it was
 * opened from, taking the row with it.
 *
 * The previous value always comes from the server's own copy of the task. It is
 * never reconstructed from what the app thinks the old state was — the rule
 * D-write and D-vocab both keep, that a plausible invented value is worse than
 * no offer at all.
 */

export interface UndoableChange {
  /** One short sentence, in the user's vocabulary. */
  message: string;
  /** The patch that puts it back. Goes through `updateTask` like any other. */
  previous: TaskPatch;
}

export interface ChangeContext {
  projectName: (projectId: number) => string;
  /** The same label the dialog shows, so the toast cannot disagree with it. */
  describeDue: (iso: string) => string;
}

/** Vikunja's "unset" date and an absent one are the same fact (§6 item 16). */
function dueOf(task: Task): string | null {
  const due = task.due_date;
  if (!due || due === VIKUNJA_NULL_DATE) return null;
  return due;
}

export function undoableChange(
  before: Task,
  values: TaskPatch,
  context: ChangeContext,
): UndoableChange | null {
  const keys = Object.keys(values);
  /*
   * One field, and only one of the three the sidebar writes.
   *
   * `title` and `description` belong to the main column, which has a Cancel of
   * its own, and `done` has the row linger of D-write — a second Undo for
   * either would be two mechanisms disagreeing about one action. More than one
   * key at a time can only mean a caller this was not written for: describing
   * it as one of them would put a message on screen that does not match what
   * happened, with an Undo that half works.
   */
  if (keys.length !== 1) return null;

  if (values.project_id !== undefined) {
    if (values.project_id === before.project_id) return null;
    return {
      message: `Moved to ${context.projectName(values.project_id)}`,
      previous: { project_id: before.project_id },
    };
  }

  if (values.due_date !== undefined) {
    const was = dueOf(before);
    const now = values.due_date === VIKUNJA_NULL_DATE ? null : values.due_date;
    if (was === now) return null;
    return {
      message:
        now === null ? "Date removed" : `Rescheduled to ${context.describeDue(now)}`,
      // Naming the column with Vikunja's null date is the only way to clear it:
      // omitting it re-reads the stored value under the bulk route's `fields`
      // guard (§6 item 16).
      previous: { due_date: was ?? VIKUNJA_NULL_DATE },
    };
  }

  if (values.priority !== undefined) {
    const was = before.priority ?? 0;
    if (values.priority === was) return null;
    return {
      // D-map-1: Vikunja counts 0-5 upwards while the UI counts P1-P4 down.
      // A toast naming Vikunja's number would be a lie in a language the
      // reader does not speak.
      message:
        values.priority === 0
          ? "Priority removed"
          : `Priority set to ${priorityLabel(priorityFromVikunja(values.priority))}`,
      previous: { priority: was },
    };
  }

  return null;
}

/** The two halves of a label pick; the third, creation, is not undoable. */
export type LabelPick = { labelId: number; attached: boolean } | { create: string };

export interface UndoableLabel {
  message: string;
  previous: { labelId: number; attached: boolean };
}

/**
 * Attaching and detaching a label are each other's undo.
 *
 * CREATING one is not offered, and that is the point of this function rather
 * than an oversight in it. A new label goes into a namespace shared by every
 * task on the instance, so undoing it means deleting something another task
 * may already carry. D-detail already made creation a deliberate button, not a
 * keystroke, because a typo there is not undoable by whoever made it — an Undo
 * would be that same keystroke wearing a friendlier face.
 */
export function undoableLabelChange(
  change: LabelPick,
  labelName: (labelId: number) => string | undefined,
): UndoableLabel | null {
  if ("create" in change) return null;
  const name = labelName(change.labelId);
  // Nothing is said that cannot be said properly: "Added @5" is worse than
  // silence.
  if (!name) return null;
  return {
    message: `${change.attached ? "Added" : "Removed"} @${name}`,
    previous: { labelId: change.labelId, attached: !change.attached },
  };
}

export interface UndoableReminders {
  message: string;
  previous: TaskReminder[];
}

/**
 * Reminders are replaced as a SET, never patched — §6 item 17 records what
 * happens to a task when you try to write them alone — so the only honest undo
 * is the whole previous set, taken from the server's copy.
 */
export function undoableReminderChange(
  before: readonly TaskReminder[],
  after: readonly TaskReminder[],
  describe: (reminder: TaskReminder) => string,
): UndoableReminders | null {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const first = after[0];
  const message =
    after.length === 0
      ? "Reminders cleared"
      : after.length === 1 && first
        ? `Reminder set: ${describe(first)}`
        : `${after.length} reminders set`;
  return { message, previous: [...before] };
}
