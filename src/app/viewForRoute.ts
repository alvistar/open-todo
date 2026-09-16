import type { Project } from "../api/types";
import {
  inboxView,
  type PositionSource,
  projectView,
  searchView,
  todayView,
  upcomingView,
  type ViewDef,
} from "../model/views";
import { projectIdFromRoute, type Route, searchQueryFromRoute } from "./route";

/**
 * Which `ViewDef` a route means, and whether it means one at all.
 *
 * This lives in `app/` rather than `model/` on purpose: it knows about routes,
 * and routes are the shell's vocabulary, not the data model's. `model/views.ts`
 * builds views out of ids and titles and stays ignorant of URLs.
 *
 * It returns BOTH answers together because they are one decision, not two.
 * `AppScreen` used to compute them in two separate `useMemo`s, each
 * enumerating the same route set - so adding a route meant editing both, and
 * forgetting the second produced a screen that contradicts itself: the sidebar
 * highlighting a view while the body shows the "not built yet" placeholder, or
 * a placeholder route quietly rendering Today's tasks. That is the same drift
 * the abandoned `read-handover` branch extracted its dispatcher to stop
 * (D-branches); this is that idea without its saved-filter and scheduled views,
 * which this branch does not have.
 */

export interface ViewForRouteInput {
  route: Route;
  /** `undefined` while `GET /projects` is still in flight - not "none". */
  projects: Project[] | undefined;
  inboxProjectId: number | null;
  /** The list view of a project, once `GET /projects` has answered (§3). */
  viewIdOf: (projectId: number) => number | undefined;
  todaySource: PositionSource | undefined;
  upcomingSource: PositionSource | undefined;
}

export interface ResolvedRoute {
  /** Null on a route nothing is built for, and null while Inbox resolves. */
  view: ViewDef | null;
  /**
   * The route the sidebar offers and nothing has built yet.
   *
   * Null for every route this function recognises, INCLUDING one whose view is
   * momentarily null. Inbox before its project id arrives is a load, not a gap,
   * and showing the "not built" screen for that half-second would be a lie that
   * corrects itself.
   */
  notBuilt: Route | null;
}

const built = (view: ViewDef | null): ResolvedRoute => ({ view, notBuilt: null });

export function viewForRoute(input: ViewForRouteInput): ResolvedRoute {
  const { route, projects, inboxProjectId, viewIdOf } = input;

  const projectId = projectIdFromRoute(route);
  if (projectId !== null) {
    const project = projects?.find((p) => p.id === projectId);
    // The title falls back rather than waiting: the rows can be fetched before
    // `GET /projects` answers, and a header reading "Project" for a moment
    // beats an empty screen.
    return built(
      projectView(projectId, project?.title ?? "Project", viewIdOf(projectId)),
    );
  }

  if (route === "inbox") {
    return built(
      inboxProjectId === null
        ? null
        : inboxView(inboxProjectId, viewIdOf(inboxProjectId)),
    );
  }

  // Null, not "", is what "this is not a search" means here: `#/search` is the
  // open, empty box and is a real route.
  const searchQuery = searchQueryFromRoute(route);
  if (searchQuery !== null) return built(searchView(searchQuery));

  if (route === "upcoming") return built(upcomingView(input.upcomingSource));
  if (route === "today") return built(todayView(input.todaySource));

  /*
   * Anything else has no view. It used to fall through to Today, which meant
   * the sidebar's Filters entry silently showed a DIFFERENT screen from the one
   * it highlighted - the defect D-detail named, one step worse than a button
   * that does nothing.
   */
  return { view: null, notBuilt: route };
}
