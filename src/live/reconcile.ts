import type { Task } from "../api/types";

/**
 * Pure merge helpers for the live layer. Kept separate from PollingSource so
 * the "what changed" logic is testable without timers.
 */

/** True when a task still belongs in the open view. */
export type BelongsPredicate = (task: Task) => boolean;

/**
 * Folds an incremental fetch into the current list.
 *
 * An incremental fetch answers "what changed", not "what is in the view", so
 * an incoming task can equally mean *added to* or *removed from* the view — a
 * task that was just completed comes back in the same response as one that was
 * just created. The predicate decides which.
 */
export function mergeUpserts(
  current: Task[],
  incoming: Task[],
  belongs: BelongsPredicate,
): Task[] {
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((task) => [task.id, task]));
  let changed = false;

  for (const task of incoming) {
    const existing = byId.get(task.id);
    if (belongs(task)) {
      // Always take the server's copy. Skipping when `updated` matches would
      // be an optimisation that can drop a real edit, and an incremental fetch
      // only returns tasks the server already said had changed.
      byId.set(task.id, task);
      changed = true;
    } else if (existing) {
      byId.delete(task.id);
      changed = true;
    }
  }

  if (!changed) return current;

  // Keep the server's order for tasks we already had, append the new ones.
  const kept: Task[] = [];
  const seen = new Set<number>();
  for (const task of current) {
    const next = byId.get(task.id);
    if (next) {
      kept.push(next);
      seen.add(task.id);
    }
  }
  for (const task of byId.values()) {
    if (!seen.has(task.id)) kept.push(task);
  }
  return kept;
}

/**
 * Ids present locally but absent from a full fetch of the same view.
 *
 * This is the only way to notice a deletion: `deleted_at` is not a filterable
 * field (mapping §6 item 3), so an incremental fetch can never report one.
 */
export function diffDeleted(current: Task[], full: Task[]): number[] {
  const present = new Set(full.map((task) => task.id));
  return current.filter((task) => !present.has(task.id)).map((task) => task.id);
}

/** The newest `updated` in a batch, which becomes the next incremental mark. */
export function latestUpdated(tasks: Task[]): Date | null {
  let newest: number | null = null;
  for (const task of tasks) {
    const time = Date.parse(task.updated);
    if (Number.isNaN(time)) continue;
    if (newest === null || time > newest) newest = time;
  }
  return newest === null ? null : new Date(newest);
}
