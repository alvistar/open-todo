import type { Project, Task } from "../api/types";
import { classifySchedule, formatDueLabel, parseVikunjaDate } from "./dates";
import type { TaskRowModel } from "./display";
import { priorityFromVikunja } from "./priority";

export interface RowContext {
  now: Date;
  timeZone: string;
  /** The user's Vikunja default_due_time, or null for the 20:00 fallback. */
  defaultDueTime: string | null;
  projectsById: Map<number, Project>;
  showProject: boolean;
  /** Ids present in the current fetch, used to resolve subtask done-counts. */
  tasksById: Map<number, Task>;
}

/**
 * Builds the row view-model. Sub-task counts come from `related_tasks.subtask`,
 * which mapping §6 item 2 verified arrives on a plain GET /tasks with no
 * `expand`; the done-count needs a client-side lookup because the relation
 * carries only id and title reliably.
 */
export function toTaskRow(task: Task, context: RowContext): TaskRowModel {
  const due = parseVikunjaDate(task.due_date);
  const subtasks = task.related_tasks?.subtask ?? [];

  const doneSubtasks = subtasks.filter((relation) => {
    const full = context.tasksById.get(relation.id);
    return (full?.done ?? relation.done) === true;
  }).length;

  const projectName = context.showProject
    ? context.projectsById.get(task.project_id)?.title
    : undefined;

  return {
    id: task.id,
    title: task.title,
    priority: priorityFromVikunja(task.priority),
    done: task.done,
    ...(task.description ? { description: stripHtml(task.description) } : {}),
    ...(due
      ? {
          due: {
            label: formatDueLabel(
              due,
              context.now,
              context.timeZone,
              context.defaultDueTime,
            ),
            kind: classifySchedule(due, context.now, context.timeZone),
          },
        }
      : {}),
    ...(subtasks.length > 0
      ? { subtasks: { done: doneSubtasks, total: subtasks.length } }
      : {}),
    ...(task.reminders && task.reminders.length > 0 ? { hasReminder: true } : {}),
    ...(task.comment_count ? { commentCount: task.comment_count } : {}),
    ...(projectName ? { projectName } : {}),
  };
}

/**
 * Vikunja stores descriptions as HTML from its own editor. The list shows one
 * clamped line, so it is rendered as text; nothing here is inserted as HTML.
 */
export function stripHtml(html: string): string {
  const withBreaks = html.replace(/<\/(p|div|br|li|h[1-6])>/gi, " ");
  const text = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}
