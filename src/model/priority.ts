/*
 * D-map-1 (docs/data-model-mapping.md §2).
 *
 * Todoist has four priorities, p1 (highest) to p4 (none). Vikunja has six,
 * 0..5, and its own UI labels 1 Low ... 5 DO NOW. The mapping is deliberately
 * lossy on read and narrow on write:
 *
 *   read   5,4 -> p1   3 -> p2   2,1 -> p3   0 -> p4
 *   write  p1 -> 4     p2 -> 3   p3 -> 2     p4 -> 0
 *
 * Tasks created elsewhere at 5 or 1 stay readable and are NOT rewritten unless
 * the user edits the priority, so open-todo never silently rewrites another
 * client's data.
 */

/** Todoist-style priority. 1 is the most urgent, 4 means "none". */
export type Priority = 1 | 2 | 3 | 4;

export const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];

/** Vikunja `priority` (0-5) -> open-todo priority. Unknown values fall back to p4. */
export function priorityFromVikunja(value: number | null | undefined): Priority {
  if (value == null || !Number.isFinite(value)) return 4;
  const v = Math.trunc(value);
  if (v >= 4) return 1;
  if (v === 3) return 2;
  if (v === 2 || v === 1) return 3;
  return 4;
}

/** open-todo priority -> the Vikunja `priority` we write. */
export function priorityToVikunja(priority: Priority): number {
  switch (priority) {
    case 1:
      return 4;
    case 2:
      return 3;
    case 3:
      return 2;
    case 4:
      return 0;
  }
}

/**
 * True when writing `priority` back would change the stored value. Lets callers
 * leave a 5 or a 1 written by another client alone.
 */
export function priorityWriteChangesValue(stored: number | null | undefined): boolean {
  const current = stored == null || !Number.isFinite(stored) ? 0 : Math.trunc(stored);
  return priorityToVikunja(priorityFromVikunja(current)) !== current;
}

export function priorityLabel(priority: Priority): string {
  return `P${priority}`;
}

/** CSS custom property carrying this priority's colour. */
export function priorityColorVar(priority: Priority): string {
  return `var(--priority-p${priority})`;
}
