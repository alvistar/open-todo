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
