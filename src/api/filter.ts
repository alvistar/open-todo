/*
 * Vikunja filter expressions.
 *
 * The exact forms here are the ones verified against the reference instance in
 * docs/data-model-mapping.md §6 — notably `updated >= '<iso>'` and the date
 * math `due_date < now/d+1d`. `deleted_at` is deliberately absent: it is not a
 * filterable field (§6 item 3), which is why deletions need id-set
 * reconciliation instead.
 */

/** Wraps a value in single quotes, doubling any quote inside it. */
export function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Joins clauses with Vikunja's AND, ignoring empty ones. */
export function and(...clauses: (string | undefined)[]): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(" && ");
}

export function or(...clauses: (string | undefined)[]): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(" || ");
}

export function notDone(): string {
  return "done = false";
}

export function isDone(): string {
  return "done = true";
}

export function projectIs(projectId: number): string {
  return `project = ${projectId}`;
}

/** Everything due before the end of today, i.e. overdue plus today. */
export function dueBeforeTomorrow(): string {
  return "due_date < now/d+1d";
}

export function labelIn(labelIds: number[]): string {
  return `labels in [${labelIds.join(", ")}]`;
}

/** Second-precision UTC, the shape the instance accepted (§6 item 4). */
export function toFilterTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** Tasks touched since `date` — the incremental-refresh filter for PollingSource. */
export function updatedSince(date: Date): string {
  return `updated >= ${quote(toFilterTimestamp(date))}`;
}
