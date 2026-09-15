import type { Priority } from "./priority";

/** How a due date is coloured in a row (layout-specs §0, "Date:" tokens). */
export type ScheduleKind = "overdue" | "today" | "tomorrow" | "next-week" | "later";

export interface DueDisplay {
  /** Already formatted for the viewer's locale and timezone. */
  label: string;
  kind: ScheduleKind;
}

/** Everything a task row draws. Deliberately independent of the API shape. */
export interface TaskRowModel {
  id: number;
  title: string;
  description?: string;
  priority: Priority;
  done: boolean;
  due?: DueDisplay;
  subtasks?: { done: number; total: number };
  commentCount?: number;
  hasReminder?: boolean;
  /** Shown right-aligned when the view spans more than one project. */
  projectName?: string;
  /**
   * Transient, from the pending map rather than from the task: what just
   * happened to this row ("Done. Next: 17 Sep", or why a write failed).
   */
  note?: string;
  /** The row is completed and still undoable (D-write). */
  undoable?: boolean;
}

export function scheduleColorVar(kind: ScheduleKind): string {
  return kind === "later" ? "var(--text-secondary)" : `var(--schedule-${kind})`;
}
