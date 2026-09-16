import type { Project, SavedFilter } from "../api/types";

/**
 * Reading Vikunja's saved filters, which is how a view that is a QUESTION gets
 * somewhere to keep an answer.
 *
 * Today is `done = false && due_date < now/d+1d` — a query, not a container.
 * Positions are stored per `(task, project_view)` (mapping §3), so a query has
 * nowhere to keep a manual order unless it exists on the server as a saved
 * filter: those arrive in `GET /projects` under a negative id and own real
 * views, which accept position writes (§6 items 15 and 24).
 */

/**
 * The saved filter behind a negative project id.
 *
 * Vikunja exposes a filter as `project_id = -(filter_id + 1)`. Measured rather
 * than read: a scratch filter created as id 10 came back as project -11, and
 * on `pinguino` Today is -10 and is filter 9 (§6 item 24).
 */
export function filterIdFromProjectId(projectId: number): number {
  return -projectId - 1;
}

/**
 * The saved filter with this title, if the instance has one.
 *
 * The negative id is the ONLY thing separating a filter from a project (§6
 * item 15), so it is tested first: a real project called "Today" is a place
 * tasks can be put, and must never be mistaken for the filter.
 */
export function findSavedFilter(
  projects: Project[] | undefined,
  title: string,
): Project | undefined {
  return projects?.find((project) => project.id < 0 && project.title === title);
}

/**
 * Whether a saved filter asks the question we would have asked.
 *
 * This is not a formality. A filter is what PRODUCES the task list, not merely
 * where the order is kept — so adopting one changes what the screen shows.
 * `pinguino` already had a `Today` written by someone other than us, and its
 * query turned out to match character for character (§6 item 26); on an
 * instance where it does not, open-todo keeps its own query and simply offers
 * no manual order, which is quieter and more honest than showing a different
 * set of tasks under a familiar name.
 *
 * Whitespace is forgiven because it is not part of the question.
 */
export function asksTheSameAs(saved: SavedFilter | undefined, expected: string): boolean {
  const query = saved?.filters?.filter;
  if (!query) return false;
  const normalise = (text: string) => text.trim().replace(/\s+/g, " ");
  return normalise(query) === normalise(expected);
}
