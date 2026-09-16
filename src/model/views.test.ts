import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import {
  compareByDueDateThenId,
  compareByPositionThenId,
  inboxView,
  todayView,
  upcomingView,
} from "./views";

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

describe("compareByPositionThenId", () => {
  const at = (id: number, position?: number) =>
    ({
      id,
      title: "t",
      project_id: 1,
      ...(position === undefined ? {} : { position }),
    }) as Task;

  it("orders by the view's position", () => {
    const sorted = [at(3, 30), at(1, 10), at(2, 20)].sort(compareByPositionThenId);
    expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("treats 0 as a real position, not as a missing one", () => {
    // §3: the first task in an empty view gets 0. Reading it as "absent" would
    // send whichever task happens to be first to the bottom of its own list.
    const sorted = [at(2, 5), at(1, 0)].sort(compareByPositionThenId);
    expect(sorted.map((t) => t.id)).toEqual([1, 2]);
  });

  it("puts a task with no position last", () => {
    // Not a position of 0: the incremental poll reads through a flat GET,
    // where §3 says the field means nothing, so reconcile.ts drops it. Such a
    // task waits at the bottom until the next full fetch places it properly.
    const sorted = [at(2), at(1, 900_000)].sort(compareByPositionThenId);
    expect(sorted.map((t) => t.id)).toEqual([1, 2]);
  });

  it("falls back to id when two tasks share a position", () => {
    const sorted = [at(9, 4), at(4, 4)].sort(compareByPositionThenId);
    expect(sorted.map((t) => t.id)).toEqual([4, 9]);
  });

  it("keeps positionless tasks in id order among themselves", () => {
    const sorted = [at(8), at(2)].sort(compareByPositionThenId);
    expect(sorted.map((t) => t.id)).toEqual([2, 8]);
  });
});

describe("a view that knows its Vikunja view", () => {
  it("orders by position and says where the order lives", () => {
    const view = inboxView(7, 5);
    expect(view.positionSource).toEqual({ projectId: 7, viewId: 5 });
    expect(view.compare).toBe(compareByPositionThenId);
  });

  it("keys separately from the same view read the flat way", () => {
    // The two read different endpoints and produce differently ORDERED
    // arrays; sharing a cache entry would render one through the other for as
    // long as it took the view id to resolve.
    expect(inboxView(7, 5).key).not.toBe(inboxView(7).key);
  });

  it("falls back to the due-date order when no view could be resolved", () => {
    const view = inboxView(7);
    expect(view.positionSource).toBeUndefined();
    expect(view.compare).toBe(compareByDueDateThenId);
  });

  it("still excludes sub-tasks, and belongs still implies includes", () => {
    const view = inboxView(7, 5);
    const child = task({
      project_id: 7,
      related_tasks: { parenttask: [{ id: 2, title: "p" }] },
    } as Partial<Task>);
    expect(view.includes(child)).toBe(false);
    expect(view.belongs(child, new Date(), "Europe/Rome")).toBe(false);
  });
});

describe("upcomingView", () => {
  const view = upcomingView();

  it("asks the server for tomorrow onwards", () => {
    expect(view.filter).toBe("done = false && due_date >= now/d+1d");
    // Undated tasks are not upcoming; including nulls would put every one of
    // them in a view whose sections are days.
    expect(view.includeNulls).toBe(false);
  });

  it("accepts tomorrow and later, rejects today, overdue and undated", () => {
    const at = (due?: string) => (due ? task({ due_date: due }) : task({}));
    expect(view.belongs(at("2026-09-10T08:00:00Z"), NOW, TZ)).toBe(true);
    expect(view.belongs(at("2026-12-01T08:00:00Z"), NOW, TZ)).toBe(true);
    expect(view.belongs(at("2026-09-09T20:00:00Z"), NOW, TZ)).toBe(false);
    expect(view.belongs(at("2026-09-01T08:00:00Z"), NOW, TZ)).toBe(false);
    expect(view.belongs(at(), NOW, TZ)).toBe(false);
  });

  it("partitions the dated tasks with Today: no overlap, no gap", () => {
    /*
     * The two filters are the same boundary written from either side, so this
     * is the property that keeps a task from vanishing between the screens -
     * or appearing on both, which would give it two manual orders.
     */
    const today = todayView();
    for (const iso of [
      "2026-09-01T08:00:00Z",
      "2026-09-09T00:30:00Z",
      "2026-09-09T23:30:00Z",
      "2026-09-10T00:30:00Z",
      "2026-12-31T23:00:00Z",
    ]) {
      const t = task({ due_date: iso });
      const inToday = today.belongs(t, NOW, TZ);
      const inUpcoming = view.belongs(t, NOW, TZ);
      expect(inToday && inUpcoming).toBe(false);
      expect(inToday || inUpcoming).toBe(true);
    }
  });

  it("excludes sub-tasks, and belongs still implies includes", () => {
    const child = task({
      due_date: "2026-09-20T08:00:00Z",
      related_tasks: { parenttask: [{ id: 2, title: "p" }] },
    } as Partial<Task>);
    expect(view.includes(child)).toBe(false);
    expect(view.belongs(child, NOW, TZ)).toBe(false);
  });

  it("orders by position once it knows its view, like any other list", () => {
    const ordered = upcomingView({ projectId: -9, viewId: 41 });
    expect(ordered.positionSource).toEqual({ projectId: -9, viewId: 41 });
    expect(ordered.compare).toBe(compareByPositionThenId);
    expect(ordered.key).not.toBe(view.key);
    // The grouping must not depend on the key - the mistake Today made.
    expect(ordered.grouping).toBe("everyDueDay");
  });
});
