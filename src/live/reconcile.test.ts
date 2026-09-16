import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { carryViewPosition, diffDeleted, latestUpdated, mergeUpserts } from "./reconcile";

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

describe("carryViewPosition", () => {
  /*
   * The incremental poll is deliberately a flat `GET /tasks` (useLiveSource
   * explains why), and mapping §3 says a task read that way has no meaningful
   * position - the server sends 0. Taking the server's copy wholesale, which
   * is mergeUpserts' normal contract, would therefore drop every edited task
   * to position 0 and send it to the top of a manually ordered list.
   */

  it("keeps the position we read through the view", () => {
    const existing = task(1, { position: 4096 });
    const incoming = task(1, { title: "renamed", position: 0 });
    const merged = carryViewPosition(existing, incoming);
    expect(merged.position).toBe(4096);
    expect(merged.title).toBe("renamed");
  });

  it("keeps it when the flat copy omits the field entirely", () => {
    expect(carryViewPosition(task(1, { position: 4096 }), task(1)).position).toBe(4096);
  });

  it("does not resurrect a position for a task we have never placed", () => {
    // Undefined, not 0: 0 is a real position (§3 gives it to the first task in
    // an empty view), so writing 0 here would claim the top of the list. The
    // comparator sorts an undefined position last, which is where a task we
    // cannot place belongs until the next full fetch says otherwise.
    const merged = carryViewPosition(undefined, task(9, { position: 0 }));
    expect(merged.position).toBeUndefined();
  });

  it("still takes every other field from the server", () => {
    const merged = carryViewPosition(
      task(1, { position: 10, title: "old", done: false }),
      task(1, { position: 0, title: "new", done: true }),
    );
    expect(merged).toMatchObject({ title: "new", done: true, position: 10 });
  });

  it("does not mutate either input", () => {
    const existing = task(1, { position: 10 });
    const incoming = task(1, { position: 0 });
    carryViewPosition(existing, incoming);
    expect(existing.position).toBe(10);
    expect(incoming.position).toBe(0);
  });

  it("believes a non-zero position the incoming copy actually carries", () => {
    // A full fetch goes through the view endpoint, so its positions are real
    // and must win - otherwise the app could never learn about a reorder made
    // on another device.
    expect(
      carryViewPosition(task(1, { position: 10 }), task(1, { position: 20 })).position,
    ).toBe(20);
  });
});

describe("mergeUpserts with an adopt hook", () => {
  it("routes both the known and the unknown case through it", () => {
    const current = [task(1, { position: 5 })];
    const merged = mergeUpserts(
      current,
      [task(1, { position: 0 }), task(2, { position: 0 })],
      () => true,
      carryViewPosition,
    );
    expect(merged.map((t) => [t.id, t.position])).toEqual([
      [1, 5],
      [2, undefined],
    ]);
  });
});
