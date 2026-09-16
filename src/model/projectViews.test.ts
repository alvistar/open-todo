/*
 * Finding the view whose order a list reads and writes (mapping §3).
 *
 * `GET /projects` carries every project's views inline on `pinguino` (§6 item
 * 25), so this is a lookup rather than a request — but it has to fail quietly,
 * because a view we cannot resolve is a list that still has to render, just
 * without a manual order.
 */
import { describe, expect, it } from "vitest";
import type { Project } from "../api/types";
import { listViewId } from "./projectViews";

const project = (views: Project["views"]): Project => ({
  id: 1,
  title: "Inbox",
  ...(views === undefined ? {} : { views }),
});

describe("listViewId", () => {
  it("finds the list view among the four a project gets", () => {
    expect(
      listViewId(
        project([
          { id: 1, project_id: 1, title: "List", view_kind: "list" },
          { id: 2, project_id: 1, title: "Gantt", view_kind: "gantt" },
          { id: 3, project_id: 1, title: "Table", view_kind: "table" },
          { id: 4, project_id: 1, title: "Kanban", view_kind: "kanban" },
        ]),
      ),
    ).toBe(1);
  });

  it("ignores a kanban view, whose positions are a different order entirely", () => {
    // §6 item 5: the same tasks carry different positions in the list and the
    // kanban view. Reordering against the wrong one would write a real order
    // into a space nothing on this screen reads.
    expect(
      listViewId(project([{ id: 8, project_id: 1, title: "Kanban", view_kind: "kanban" }])),
    ).toBeNull();
  });

  it("returns null rather than guessing when the project has no views", () => {
    expect(listViewId(project([]))).toBeNull();
    expect(listViewId(project(undefined))).toBeNull();
    expect(listViewId(project(null))).toBeNull();
  });

  it("returns null for a project that is not there at all", () => {
    expect(listViewId(undefined)).toBeNull();
  });

  it("takes the first list view when a project somehow has two", () => {
    expect(
      listViewId(
        project([
          { id: 5, project_id: 1, title: "List", view_kind: "list" },
          { id: 9, project_id: 1, title: "Another list", view_kind: "list" },
        ]),
      ),
    ).toBe(5);
  });
});
