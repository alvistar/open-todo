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
    .filter((p) => p.id !== inboxProjectId && !p.is_archived)
    .sort((a, b) => a.title.localeCompare(b.title));
}
