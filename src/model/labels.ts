import type { Label } from "../api/types";

/**
 * Labels are a sub-resource, not a column (mapping §2): they are attached and
 * detached one call at a time and never travel in a task write.
 */

/**
 * The labels that could still be put on this task, matching what was typed.
 *
 * Sorted here rather than at the call site because the server returns them in
 * creation order, which is meaningless to the person reading the list.
 */
export function attachableLabels(
  all: readonly Label[],
  attached: readonly Label[],
  query: string,
): Label[] {
  const taken = new Set(attached.map((label) => label.id));
  const needle = query.trim().toLowerCase();

  return all
    .filter((label) => !taken.has(label.id) && label.title.toLowerCase().includes(needle))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Whether what was typed could become a NEW label.
 *
 * False for an empty field, and false when a label of that name already
 * exists - attached or not. Vikunja does not enforce unique titles, so
 * offering "create" beside an identical name is how an instance ends up with
 * two labels called `urgent` and no way to tell them apart.
 */
export function canCreateLabel(all: readonly Label[], query: string): boolean {
  const name = query.trim().toLowerCase();
  if (!name) return false;
  return !all.some((label) => label.title.trim().toLowerCase() === name);
}
