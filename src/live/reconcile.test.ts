import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { diffDeleted, latestUpdated, mergeUpserts } from "./reconcile";

const task = (id: number, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: `t${id}`,
    done: false,
    project_id: 1,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
    ...over,
  }) as Task;

// A view that holds every open task.
const isOpen = (t: Task) => !t.done;

describe("mergeUpserts", () => {
  it("replaces a task that changed, keeping its place", () => {
    const current = [task(1), task(2), task(3)];
    const merged = mergeUpserts(current, [task(2, { title: "changed" })], isOpen);
    expect(merged.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(merged[1]?.title).toBe("changed");
  });

  it("appends a task that newly belongs to the view", () => {
    const merged = mergeUpserts([task(1)], [task(9)], isOpen);
    expect(merged.map((t) => t.id)).toEqual([1, 9]);
  });

  it("removes a task that no longer belongs, e.g. just completed", () => {
    const merged = mergeUpserts([task(1), task(2)], [task(2, { done: true })], isOpen);
    expect(merged.map((t) => t.id)).toEqual([1]);
  });

  it("ignores an incoming task that never belonged", () => {
    const merged = mergeUpserts([task(1)], [task(5, { done: true })], isOpen);
    expect(merged.map((t) => t.id)).toEqual([1]);
  });

  it("returns the same array reference when nothing changed", () => {
    const current = [task(1), task(2)];
    expect(mergeUpserts(current, [], isOpen)).toBe(current);
  });

  it("does not mutate the input", () => {
    const current = [task(1)];
    mergeUpserts(current, [task(1, { title: "x" }), task(2)], isOpen);
    expect(current).toHaveLength(1);
    expect(current[0]?.title).toBe("t1");
  });
});

describe("diffDeleted", () => {
  it("reports ids the full fetch no longer contains", () => {
    expect(diffDeleted([task(1), task(2), task(3)], [task(1), task(3)])).toEqual([2]);
  });

  it("reports nothing when the sets agree", () => {
    expect(diffDeleted([task(1)], [task(1)])).toEqual([]);
  });

  it("reports nothing for tasks the full fetch added", () => {
    expect(diffDeleted([task(1)], [task(1), task(2)])).toEqual([]);
  });

  it("reports everything when the view emptied", () => {
    expect(diffDeleted([task(1), task(2)], [])).toEqual([1, 2]);
  });
});

describe("latestUpdated", () => {
  it("returns the newest server timestamp", () => {
    const newest = latestUpdated([
      task(1, { updated: "2026-09-01T00:00:00Z" }),
      task(2, { updated: "2026-09-05T12:00:00Z" }),
      task(3, { updated: "2026-09-03T00:00:00Z" }),
    ]);
    expect(newest?.toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("returns null for an empty list, so the caller keeps its old mark", () => {
    expect(latestUpdated([])).toBeNull();
  });

  it("ignores unparseable timestamps", () => {
    expect(latestUpdated([task(1, { updated: "nonsense" })])).toBeNull();
  });
});
