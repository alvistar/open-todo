import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { inboxView, todayView } from "./views";

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
