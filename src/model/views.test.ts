import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { compareByDueDateThenId, inboxView, todayView } from "./views";

const TZ = "Europe/Rome";
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

describe("inboxView", () => {
  const view = inboxView(7);

  it("builds the documented filter and sort", () => {
    expect(view.filter).toBe("done = false && project = 7");
    expect(view.sortBy).toEqual(["due_date", "id"]);
    expect(view.includeNulls).toBe(true);
  });

  it("accepts open tasks of that project only", () => {
    expect(view.belongs(task({ project_id: 7 }), NOW, TZ)).toBe(true);
    expect(view.belongs(task({ project_id: 8 }), NOW, TZ)).toBe(false);
    expect(view.belongs(task({ project_id: 7, done: true }), NOW, TZ)).toBe(false);
  });
});

describe("todayView", () => {
  const view = todayView();

  it("builds the verified Today filter", () => {
    expect(view.filter).toBe("done = false && due_date < now/d+1d");
  });

  it("accepts overdue and today, rejects later and undated", () => {
    expect(view.belongs(task({ due_date: "2026-09-01T10:00:00Z" }), NOW, TZ)).toBe(true);
    expect(view.belongs(task({ due_date: "2026-09-09T18:00:00Z" }), NOW, TZ)).toBe(true);
    expect(view.belongs(task({ due_date: "2026-09-10T18:00:00Z" }), NOW, TZ)).toBe(false);
    expect(view.belongs(task({}), NOW, TZ)).toBe(false);
    expect(view.belongs(task({ due_date: "0001-01-01T00:00:00Z" }), NOW, TZ)).toBe(false);
  });

  it("rejects a task that was just completed", () => {
    expect(
      view.belongs(task({ due_date: "2026-09-09T18:00:00Z", done: true }), NOW, TZ),
    ).toBe(false);
  });
});

describe("compareByDueDateThenId", () => {
  const due = (id: number, d?: string) => task({ id, ...(d ? { due_date: d } : {}) });

  it("orders by due date, then id, mirroring the server sort", () => {
    const sorted = [
      due(3, "2026-09-11T10:00:00Z"),
      due(1, "2026-09-10T10:00:00Z"),
      due(2, "2026-09-10T10:00:00Z"),
    ].sort(compareByDueDateThenId);
    expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("puts undated tasks last", () => {
    const sorted = [due(1), due(2, "2026-09-10T10:00:00Z")].sort(compareByDueDateThenId);
    expect(sorted.map((t) => t.id)).toEqual([2, 1]);
  });

  it("treats Vikunja's zero date as undated", () => {
    const sorted = [due(1, "0001-01-01T00:00:00Z"), due(2, "2026-09-10T10:00:00Z")].sort(
      compareByDueDateThenId,
    );
    expect(sorted.map((t) => t.id)).toEqual([2, 1]);
  });
});

/*
 * Sub-tasks are shown under their parent and nowhere else. Two places have to
 * agree about that - the client-side filter on the fetched list and the
 * `belongs` predicate the poll uses to decide whether a changed task is still
 * in view - so `belongs` is DEFINED in terms of `includes`, and this is what
 * holds them together.
 */
describe("sub-tasks are not listed on their own", () => {
  const child = (over: Partial<Task> = {}) =>
    task({
      related_tasks: { parenttask: [{ id: 99, title: "parent", done: false }] },
      ...over,
    });

  const views = [
    ["inbox", inboxView(1)],
    ["today", todayView()],
  ] as const;

  for (const [name, view] of views) {
    it(`${name} excludes a task that has a parent`, () => {
      expect(view.includes(child())).toBe(false);
      expect(view.includes(task({}))).toBe(true);
    });

    it(`${name}: anything that belongs is also included`, () => {
      const candidates = [
        task({}),
        task({ due_date: "2026-09-09T10:00:00Z" }),
        child(),
        child({ due_date: "2026-09-09T10:00:00Z" }),
        child({ project_id: 1 }),
      ];

      for (const candidate of candidates) {
        if (view.belongs(candidate, NOW, TZ)) {
          expect(view.includes(candidate)).toBe(true);
        }
      }
    });

    it(`${name} keeps a task whose only relation is a CHILD`, () => {
      // A parent is an ordinary row; it is the child that disappears.
      const parent = task({
        related_tasks: { subtask: [{ id: 5, title: "child", done: false }] },
        due_date: "2026-09-09T10:00:00Z",
      });
      expect(view.includes(parent)).toBe(true);
    });
  }
});
