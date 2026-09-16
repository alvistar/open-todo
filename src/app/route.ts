import { useCallback, useSyncExternalStore } from "react";

/**
 * Hash routing, so the built app is a folder of static files that works on any
 * host with no rewrite rules (D5: deployable to Caddy, nginx, Pages).
 *
 * Routes: #/inbox, #/today, #/project/:id
 */
export type Route = string;

export const DEFAULT_ROUTE = "today";

function read(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash || DEFAULT_ROUTE;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(subscribe, read, () => DEFAULT_ROUTE);
  const navigate = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
  }, []);
  return [route, navigate];
}

/** Returns the project id when the route is #/project/:id. */
export function projectIdFromRoute(route: Route): number | null {
  const match = /^project\/(\d+)$/.exec(route);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

/**
 * What to call a route on screen.
 *
 * Only needed for the ones the sidebar offers and nothing has built: they used
 * to fall through to Today, so the heading said "Today" while the sidebar
 * highlighted "Search". Naming the screen the user asked for, and saying it is
 * not built, is the smallest honest thing.
 */
export function routeTitle(route: Route): string {
  if (route === "search") return "Search";
  if (route === "labels") return "Filters & labels";
  if (route === "upcoming") return "Upcoming";
  if (route === "inbox") return "Inbox";
  if (route === "today") return "Today";
  return route;
}
