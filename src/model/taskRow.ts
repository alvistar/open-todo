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
 * `expand`.
 *
 * The done-half of the "0/3" badge is the delicate part. Mapping §6 item 2
 * says "children are themselves in the listing", but that only holds for
 * children matching the view's filter — and every view here filters
 * `done = false`, so a COMPLETED child is exactly the one that is absent. The
 * in-fetch copy is therefore preferred only as the fresher of the two, and the
 * relation's own `done` is what actually carries the count. Vikunja types
 * related_tasks as full Task objects, so it should be populated; if it ever is
 * not, this badge under-reports as 0/N rather than misreporting a wrong count.
 * src/api/integration.test.ts checks this against a real instance.
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
