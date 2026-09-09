import { describe, expect, it } from "vitest";
import type { Project, Task } from "../api/types";
import { type RowContext, stripHtml, toTaskRow } from "./taskRow";

const NOW = new Date("2026-09-09T08:00:00Z");

const task = (over: Partial<Task>): Task =>
  ({
    id: 1,
    title: "t",
    done: false,
    project_id: 1,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
    ...over,
  }) as Task;

function context(over: Partial<RowContext> = {}): RowContext {
  return {
    now: NOW,
    timeZone: "Europe/Rome",
    defaultDueTime: null,
    projectsById: new Map<number, Project>([[1, { id: 1, title: "Work" } as Project]]),
    showProject: true,
    tasksById: new Map(),
    ...over,
  };
}

describe("toTaskRow", () => {
  it("maps priority through D-map-1", () => {
    expect(toTaskRow(task({ priority: 4 }), context()).priority).toBe(1);
    expect(toTaskRow(task({ priority: 0 }), context()).priority).toBe(4);
    expect(toTaskRow(task({}), context()).priority).toBe(4);
  });

  it("omits the due block when there is no due date", () => {
    expect(
      toTaskRow(task({ due_date: "0001-01-01T00:00:00Z" }), context()).due,
    ).toBeUndefined();
  });

  it("labels and colours the due date", () => {
    const row = toTaskRow(task({ due_date: "2026-09-09T08:00:00Z" }), context());
    expect(row.due).toEqual({ label: "Today 10:00", kind: "today" });
  });

  it("counts subtasks, resolving done from the tasks in the same fetch", () => {
    const child = task({ id: 2, done: true });
    const parent = task({
      id: 1,
      related_tasks: {
        subtask: [
          { id: 2, title: "a" },
          { id: 3, title: "b" },
        ],
      },
    });
    const row = toTaskRow(parent, context({ tasksById: new Map([[2, child]]) }));
    // id 3 is not in the fetch (it is done and the view excludes it), so it
    // falls back to the relation's own flag, which is absent: not done.
    expect(row.subtasks).toEqual({ done: 1, total: 2 });
  });

  it("has no subtask badge when there are no subtasks", () => {
    expect(toTaskRow(task({ related_tasks: {} }), context()).subtasks).toBeUndefined();
  });

  it("shows the project name only when the view spans projects", () => {
    expect(toTaskRow(task({}), context()).projectName).toBe("Work");
    expect(
      toTaskRow(task({}), context({ showProject: false })).projectName,
    ).toBeUndefined();
  });

  it("renders the description as text, never as HTML", () => {
    const row = toTaskRow(
      task({ description: "<p>Ask about <b>Q3</b></p><p>and VAT</p>" }),
      context(),
    );
    expect(row.description).toBe("Ask about Q3 and VAT");
  });

  it("drops an empty Vikunja description", () => {
    expect(toTaskRow(task({ description: "" }), context()).description).toBeUndefined();
  });
});

describe("stripHtml", () => {
  it("decodes entities and collapses whitespace", () => {
    expect(stripHtml("<p>a &amp;&nbsp;b</p>\n<p>c</p>")).toBe("a & b c");
  });

  it("removes tags without letting markup through", () => {
    expect(stripHtml('<img src=x onerror="alert(1)">hi')).toBe("hi");
  });
});
