import type { TaskPatch } from "../api/endpoints";
import type { Task } from "../api/types";
import { parseVikunjaDate } from "./dates";
import { parseQuickAdd, type QuickAddContext } from "./quickadd/parse";

/**
 * What saving an edited task NAME would do.
 *
 * The name is read by the composer's grammar, so "call mum tomorrow" in the
 * detail dialog means what it means in the composer - Todoist does the same,
 * measured 2026-09-15. The sidebar is the feedback: it shows the date, the
 * project and the priority the phrase would set, before Save is pressed. There
 * are no chips here; the owner chose the sidebar as the one place that says
 * what will happen.
 *
 * Only columns that would CHANGE are named. Naming a column is what makes it
 * written (mapping §6 item 13), so re-writing a value that already matches is
 * a free chance to clobber a concurrent edit, for no gain.
 *
 * A label the phrase names but the instance does not have is left in the name,
 * which is what the acceptor already does with it. Creating a label is a button
 * in the label picker and never a side effect of typing - see `labels.ts`.
 */

export interface TitleEdit {
  /** The columns Save writes, or null when it must not save at all. */
  values: TaskPatch | null;
  /** Labels the phrase named that are not on the task yet. Written after. */
  addLabelIds: number[];
  /** What the sidebar shows while the editor is open. */
  preview: {
    title: string;
    dueDate: Date | null;
    /** Raw Vikunja priority, or null when the phrase named none. */
    priority: number | null;
    projectId: number | null;
    labelIds: number[];
  };
  warnings: string[];
  /** Why saving is refused, in the user's words. Null when it is not. */
  problem: string | null;
}

export function titleEdit(raw: string, task: Task, context: QuickAddContext): TitleEdit {
  const parsed = parseQuickAdd(raw, context);
  const title = parsed.title.trim();

  const attached = new Set((task.labels ?? []).map((label) => label.id));
  const addLabelIds = parsed.labelIds.filter((id) => !attached.has(id));

  const preview = {
    title,
    dueDate: parsed.dueDate,
    priority: parsed.priority,
    projectId: parsed.projectId,
    labelIds: parsed.labelIds,
  };

  if (!title) {
    /*
     * "tomorrow" on its own parses to a date and an empty name. Saving it
     * would blank the task's name, which no view can show and nothing in this
     * app can undo.
     */
    return {
      values: null,
      addLabelIds,
      preview,
      warnings: parsed.warnings,
      problem: "A task needs a name.",
    };
  }

  const values: TaskPatch = { title };

  const storedDue = parseVikunjaDate(task.due_date);
  if (parsed.dueDate && parsed.dueDate.getTime() !== storedDue?.getTime()) {
    values.due_date = parsed.dueDate.toISOString();
  }
  if (parsed.priority !== null && parsed.priority !== (task.priority ?? 0)) {
    values.priority = parsed.priority;
  }
  if (parsed.projectId !== null && parsed.projectId !== task.project_id) {
    values.project_id = parsed.projectId;
  }

  return { values, addLabelIds, preview, warnings: parsed.warnings, problem: null };
}
