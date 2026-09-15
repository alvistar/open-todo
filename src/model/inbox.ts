import type { Project, User } from "../api/types";

/**
 * The Inbox is Vikunja's default project (mapping §1). GET /user reports it as
 * settings.default_project_id, verified as 1 on the reference instance.
 *
 * A scoped API token can be refused on /user while still reading tasks, so
 * there is a fallback chain: the project literally titled "Inbox", else the
 * lowest id, which is the one Vikunja creates on signup.
 */
export function resolveInboxProjectId(
  user: User | undefined,
  projects: Project[] | undefined,
): number | null {
  const fromSettings = user?.settings?.default_project_id;
  if (typeof fromSettings === "number" && fromSettings > 0) return fromSettings;

  if (!projects || projects.length === 0) return null;

  const named = projects.find((p) => p.title.trim().toLowerCase() === "inbox");
  if (named) return named.id;

  return projects.reduce((lowest, p) => (p.id < lowest.id ? p : lowest)).id;
}

/** Projects for the sidebar: the Inbox and archived ones are not repeated there. */
export function sidebarProjects(
  projects: Project[] | undefined,
  inboxProjectId: number | null,
): Project[] {
  return (projects ?? [])
    .filter((p) => isRealProject(p) && p.id !== inboxProjectId && !p.is_archived)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Vikunja returns a saved filter in the project list, with a NEGATIVE id
 * (measured on `pinguino` 2026-09-15: `Today` is -10, `Upcoming` is -9).
 *
 * A filter is a query, not a place. Offering one as somewhere to put a task
 * would write `project_id: -10`, and the app has no way to undo that from the
 * UI it would then be unable to list the task in.
 */
export function isRealProject(project: Pick<Project, "id">): boolean {
  return project.id > 0;
}
