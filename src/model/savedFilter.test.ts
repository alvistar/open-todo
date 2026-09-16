import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import {
  isSavedFilterProject,
  ownedFilterProject,
  ownershipMarker,
  parseOwnershipMarker,
  savedFilterId,
  savedFilterProjectId,
  savedFilters,
} from "./savedFilter";

/*
 * Vikunja has no endpoint that lists saved filters: GET /filters is 405. They
 * arrive inside GET /projects wearing a negative id, `-(filterId + 1)`.
 * Verified against the instance on 2026-09-10 (mapping §9).
 */
describe("the pseudo-project encoding", () => {
  it("matches the ids the server actually returned", () => {
    // Filter 1 came back as project -2, filter 2 as -3, filter 3 as -4.
    expect(savedFilterProjectId(1)).toBe(-2);
    expect(savedFilterProjectId(2)).toBe(-3);
    expect(savedFilterProjectId(3)).toBe(-4);
  });

  it("round-trips", () => {
    for (const id of [1, 2, 3, 42, 1000]) {
      expect(savedFilterId(savedFilterProjectId(id))).toBe(id);
    }
  });

  it("refuses to read a real project as a filter", () => {
    expect(savedFilterId(1)).toBeNull();
    expect(savedFilterId(0)).toBeNull();
    // -1 is not a filter either: the encoding starts at -2.
    expect(savedFilterId(-1)).toBeNull();
  });
});

describe("isSavedFilterProject", () => {
  it("is true only for the negative ids", () => {
    expect(isSavedFilterProject({ id: -3 } as Project)).toBe(true);
    expect(isSavedFilterProject({ id: 3 } as Project)).toBe(false);
  });
});

describe("savedFilters", () => {
  const projects = [
    { id: 1, title: "Inbox" },
    { id: -3, title: "Scadenze" },
    { id: 2, title: "Lavoro" },
    { id: -2, title: "Deleghe" },
  ] as Project[];

  it("picks them out of the projects response and names them by filter id", () => {
    expect(savedFilters(projects)).toEqual([
      { id: 1, title: "Deleghe" },
      { id: 2, title: "Scadenze" },
    ]);
  });

  it("sorts by title, like the sidebar's projects do", () => {
    const sorted = savedFilters(projects).map((f) => f.title);
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  });

  it("is empty when the user has none, which is the common case", () => {
    expect(savedFilters([{ id: 1, title: "Inbox" }] as Project[])).toEqual([]);
    expect(savedFilters(undefined)).toEqual([]);
  });

  it("skips an archived filter, as the sidebar does for projects", () => {
    const withArchived = [
      { id: -2, title: "Vecchio", is_archived: true },
      { id: -3, title: "Attivo" },
    ] as Project[];
    expect(savedFilters(withArchived).map((f) => f.title)).toEqual(["Attivo"]);
  });
});

/*
 * The ownership marker.
 *
 * Tasks have no custom fields, but a saved filter has a `description`, and
 * `SavedFilter.ToProject()` copies it onto the pseudo-project - so it is
 * readable straight from GET /projects. That makes it the only durable place
 * this app can record "I made this one", which is what keeps it from ever
 * touching a filter the user wrote.
 */
describe("the ownership marker", () => {
  it("names the slot and the version, so a migration is distinguishable", () => {
    // Without a version, a canonical rule change and a hand edit look the same.
    expect(ownershipMarker("today")).toBe("open-todo:today:v1");
    expect(ownershipMarker("upcoming")).toBe("open-todo:upcoming:v1");
  });

  it("reads a marker back into its slot and version", () => {
    expect(parseOwnershipMarker("open-todo:today:v1")).toEqual({
      slot: "today",
      version: 1,
    });
    expect(parseOwnershipMarker("open-todo:upcoming:v3")).toEqual({
      slot: "upcoming",
      version: 3,
    });
  });

  it("refuses anything that is not ours", () => {
    for (const text of [
      undefined,
      "",
      "le mie scadenze",
      "open-todo",
      "open-todo:today",
      "open-todo:sideways:v1",
      "open-todo:today:vx",
      "not-open-todo:today:v1",
    ]) {
      expect(parseOwnershipMarker(text)).toBeNull();
    }
  });

  it("ignores surrounding whitespace, which a UI can introduce", () => {
    expect(parseOwnershipMarker("  open-todo:today:v1\n")).toEqual({
      slot: "today",
      version: 1,
    });
  });
});

describe("savedFilters hides the ones this app owns", () => {
  const projects = [
    { id: 1, title: "Inbox" },
    { id: -2, title: "Scadenze" },
    { id: -3, title: "Today", description: "open-todo:today:v1" },
    { id: -4, title: "Upcoming", description: "open-todo:upcoming:v1" },
  ] as Project[];

  it("lists the user's own and not ours", () => {
    /*
     * Ours already have built-in sidebar rows. Listing them again would show
     * "Today" twice, and the filter route renders the flat projection rather
     * than the Overdue/day grouping - the same class of lie as a nav entry
     * that goes somewhere else.
     */
    expect(savedFilters(projects).map((f) => f.title)).toEqual(["Scadenze"]);
  });

  it("still lists a filter the user merely NAMED Today", () => {
    // Ownership is the marker, never the title. Someone else's "Today" is
    // theirs.
    const mine = [{ id: -5, title: "Today" }] as Project[];
    expect(savedFilters(mine).map((f) => f.title)).toEqual(["Today"]);
  });
});

describe("ownedFilterProject", () => {
  const marked = (id: number, title: string, description?: string) =>
    ({ id, title, ...(description ? { description } : {}) }) as Project;

  it("finds the filter this app stamped for a slot", () => {
    const projects = [
      marked(1, "Inbox"),
      marked(-10, "Today", "open-todo:today:v1"),
      marked(-9, "Upcoming", "open-todo:upcoming:v1"),
    ];
    expect(ownedFilterProject(projects, "today")?.id).toBe(-10);
    expect(ownedFilterProject(projects, "upcoming")?.id).toBe(-9);
  });

  it("never adopts a filter the user merely NAMED Today", () => {
    /*
     * The whole reason ownership is the marker. The version this replaced
     * matched by title and then spent a request comparing the query; this one
     * simply does not claim what it did not write, which is both cheaper and
     * the right answer when a user has a Today of their own.
     */
    expect(ownedFilterProject([marked(-10, "Today")], "today")).toBeUndefined();
  });

  it("refuses a marker written by a newer version of the app", () => {
    // It was written to a rule this build does not know, so the tasks behind
    // it are not the ones this build would have asked for.
    expect(
      ownedFilterProject([marked(-10, "Today", "open-todo:today:v99")], "today"),
    ).toBeUndefined();
  });

  it("does not confuse the two slots", () => {
    const projects = [marked(-9, "Upcoming", "open-todo:upcoming:v1")];
    expect(ownedFilterProject(projects, "today")).toBeUndefined();
  });

  it("is undefined before the projects have loaded", () => {
    expect(ownedFilterProject(undefined, "today")).toBeUndefined();
  });
});
