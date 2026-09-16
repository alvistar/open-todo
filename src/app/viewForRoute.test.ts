/*
 * Which view a route means.
 *
 * This exists as a unit rather than as two `useMemo`s inside `AppScreen`
 * because the two answers it gives - the view, and "nothing is built for this"
 * - are one classification of one route. While they were computed apart, each
 * enumerated the route set separately, and a route added to only one of them
 * rendered a screen that contradicted its own sidebar entry. The invariant at
 * the bottom of this file is what pins that shut.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import { type ViewForRouteInput, viewForRoute } from "./viewForRoute";

const projects = [
  { id: 3, title: "Personale" },
  { id: 7, title: "Lavoro" },
] as Project[];

const resolve = (route: string, over: Partial<ViewForRouteInput> = {}) =>
  viewForRoute({
    route,
    projects,
    inboxProjectId: 1,
    viewIdOf: () => undefined,
    todaySource: undefined,
    upcomingSource: undefined,
    ...over,
  });

describe("a project route", () => {
  it("names the project it found", () => {
    expect(resolve("project/7").view?.title).toBe("Lavoro");
  });

  it("does not wait for GET /projects to show the rows", () => {
    // The tasks can arrive before the project list does. A header reading
    // "Project" for a moment beats a blank screen, and beats not fetching.
    const { view } = resolve("project/7", { projects: undefined });
    expect(view?.title).toBe("Project");
    expect(view?.key).toBe("project:7");
  });

  it("keys on the list view once it is known, because the order differs", () => {
    // §3: read through a view the tasks carry positions, read flat they do
    // not. Sharing one cache entry would render one ordering through the
    // other until the id resolved, then rearrange under the reader.
    expect(resolve("project/7", { viewIdOf: () => 42 }).view?.key).toBe("project:7@v42");
  });

  it("is not mistaken for a route that merely starts with the word", () => {
    expect(resolve("projects").view).toBeNull();
  });
});

describe("the Inbox", () => {
  it("uses the id the user query resolved", () => {
    expect(resolve("inbox").view?.key).toBe("inbox:1");
  });

  it("has no view yet while the id is unknown - and that is a load, not a gap", () => {
    /*
     * The case that must not be confused with an unknown route: Inbox IS
     * built. Reporting it as not-built would flash the placeholder screen for
     * as long as `GET /user` took, then correct itself.
     */
    const { view, notBuilt } = resolve("inbox", { inboxProjectId: null });
    expect(view).toBeNull();
    expect(notBuilt).toBeNull();
  });
});

describe("a search", () => {
  it("carries the query through, decoded", () => {
    // The server gets the LONGEST term only (§8: it has no AND); the other
    // terms narrow the answer client-side. What matters here is that the
    // dispatcher decoded the route and handed the whole query on.
    const { view } = resolve("search/fattura%20notaio");
    expect(view?.key).toBe("search:fattura notaio");
    expect(view?.search).toBe("fattura");
  });

  it("treats the open, empty box as a real route", () => {
    // `#/search` is the box with nothing typed in it yet, which is a screen.
    // Only a NON-search route gives null here, never an empty query.
    const { view, notBuilt } = resolve("search");
    expect(view?.key).toBe("search:");
    expect(notBuilt).toBeNull();
  });
});

describe("Today and Upcoming", () => {
  it("are read the flat way when the app owns no saved filter", () => {
    // Mapping §4: a query has nowhere to keep a manual order. No source, no
    // positionSource, and therefore no drag handle - a missing affordance
    // rather than one that fails to persist.
    expect(resolve("today").view?.positionSource).toBeUndefined();
    expect(resolve("upcoming").view?.positionSource).toBeUndefined();
  });

  it("hang off the saved filter's list view when there is one", () => {
    const source = { projectId: -10, viewId: 9 };
    expect(resolve("today", { todaySource: source }).view?.positionSource).toEqual(
      source,
    );
    expect(resolve("upcoming", { upcomingSource: source }).view?.key).toBe("upcoming@v9");
  });
});

describe("a route nothing is built for", () => {
  it("says so instead of quietly showing Today", () => {
    /*
     * It used to fall through to Today, so the sidebar's Filters entry
     * highlighted one thing and displayed another - worse than a button that
     * does nothing, because the screen looks correct.
     */
    const { view, notBuilt } = resolve("filters");
    expect(view).toBeNull();
    expect(notBuilt).toBe("filters");
  });

  it("hands back the route itself, so the header can name it", () => {
    expect(resolve("labels").notBuilt).toBe("labels");
  });
});

describe("the invariant that made this a module", () => {
  it("never claims a route is unbuilt while handing back a view for it", () => {
    const routes = [
      "project/7",
      "project/999",
      "inbox",
      "today",
      "upcoming",
      "search",
      "search/x",
      "filters",
      "labels",
      "",
    ];
    for (const route of routes) {
      const { view, notBuilt } = resolve(route);
      if (notBuilt !== null) expect(view).toBeNull();
    }
  });
});
