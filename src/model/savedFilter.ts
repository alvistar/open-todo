import type { Project } from "../api/types";

/**
 * Saved filters, which Vikunja hands back as projects.
 *
 * There is no endpoint that lists them — `GET /filters` answers 405. They
 * arrive inside `GET /projects` carrying a NEGATIVE id, and that is the only
 * way to find them (mapping §6 items 15 and 29). So this module owns the
 * encoding, and everything that reads the projects response goes through it
 * rather than testing `id < 0` in its own way.
 *
 * PORTED from the `read-handover` branch, which solved this better than the
 * version it replaces here: that one matched a filter by TITLE and then spent a
 * `GET /filters/{id}` per view to compare the query. This reads a marker the
 * app stamps into the filter's description, which `SavedFilter.ToProject()`
 * copies onto the pseudo-project — so ownership is free, survives a rename, and
 * never hijacks a filter the user merely happened to call "Today".
 */

/** The two views this app backs with a filter of its own. */
export type OwnedSlot = "today" | "upcoming";

/** The rule shape this app currently writes. Bumped when the rule changes. */
export const MARKER_VERSION = 1;

const MARKER = /^open-todo:(today|upcoming):v(\d+)$/;

/**
 * The string this app stamps into a filter's `description` to claim it.
 *
 * Tasks have no custom fields (upstream #120, open since 2022), but a saved
 * filter has a description and `SavedFilter.ToProject()` copies it onto the
 * pseudo-project, so it is readable straight from GET /projects. It is the only
 * durable metadata an API client has here.
 *
 * The VERSION is what makes a migration distinguishable from a user edit: when
 * the canonical rule changes, an old filter of ours still says which shape it
 * was written for, so it can be migrated instead of being mistaken for
 * something the user rewrote by hand.
 */
export function ownershipMarker(slot: OwnedSlot, version = MARKER_VERSION): string {
  return `open-todo:${slot}:v${version}`;
}

/** The slot and version behind a marker, or null when it is not ours. */
export function parseOwnershipMarker(
  description: string | undefined,
): { slot: OwnedSlot; version: number } | null {
  const match = MARKER.exec((description ?? "").trim());
  if (!match?.[1] || !match[2]) return null;
  return { slot: match[1] as OwnedSlot, version: Number(match[2]) };
}

/** A saved filter as the sidebar needs it: its OWN id, not the project's. */
export interface SavedFilterSummary {
  id: number;
  title: string;
}

/** Filter 1 is project -2, filter 2 is -3: verified against the instance. */
export function savedFilterProjectId(filterId: number): number {
  return -(filterId + 1);
}

/**
 * The filter id behind a pseudo-project, or null if this is a real project.
 *
 * `-1` is not a filter: the encoding starts at `-2`, so treating "any negative
 * id" as a filter would invent filter 0 out of a value the server never sends.
 */
export function savedFilterId(projectId: number): number | null {
  if (projectId > -2) return null;
  return -projectId - 1;
}

export function isSavedFilterProject(project: Project): boolean {
  return savedFilterId(project.id) !== null;
}

/** The user's saved filters, out of the projects response. */
export function savedFilters(projects: Project[] | undefined): SavedFilterSummary[] {
  return (projects ?? [])
    .flatMap((p) => {
      // flatMap, not filter+map: it carries the id's narrowing rather than
      // re-asserting with a cast what the filter had just established.
      /*
       * App-owned filters are excluded: they already have built-in nav rows,
       * so listing them here would show "Today" twice - and the filter route
       * renders the flat projection rather than the Overdue/day grouping.
       * Ownership is the MARKER, never the title: a filter the user merely
       * named "Today" is theirs and stays listed.
       */
      if (p.is_archived || parseOwnershipMarker(p.description) !== null) return [];
      const id = savedFilterId(p.id);
      return id === null ? [] : [{ id, title: p.title }];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The pseudo-project of the filter this app owns for `slot`, if the instance
 * has one.
 *
 * Ownership is the MARKER and never the title — a filter the user named "Today"
 * is theirs, and adopting it would silently change what that screen shows.
 *
 * A marker from a FUTURE version is refused rather than adopted: it was written
 * to a rule this build does not know, so the tasks behind it are not the ones
 * this build would have asked for.
 */
export function ownedFilterProject(
  projects: Project[] | undefined,
  slot: OwnedSlot,
): Project | undefined {
  return (projects ?? []).find((project) => {
    const marker = parseOwnershipMarker(project.description);
    return marker?.slot === slot && marker.version <= MARKER_VERSION;
  });
}
