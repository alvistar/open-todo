import type { Project } from "../api/types";

/**
 * Which of a project's views holds the order this app shows.
 *
 * Vikunja gives every project four views and stores a separate position per
 * `(task, project_view)` (mapping §3). open-todo renders the LIST view, so
 * that is the only position space it may read or write: §6 item 5 measured the
 * same tasks carrying unrelated positions in the list and kanban views, and
 * writing a drop into the kanban space would produce an order nothing on this
 * screen ever reads back.
 *
 * `GET /projects` carries `views[]` inline (§6 item 25), so this costs no
 * request. Null when there is nothing to be sure of — the caller then reads
 * the view the flat way and offers no reordering, rather than guessing an id.
 */
export function listViewId(project: Project | undefined): number | null {
  const view = project?.views?.find((candidate) => candidate.view_kind === "list");
  return view?.id ?? null;
}
