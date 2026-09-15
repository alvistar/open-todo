import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { applyPending, isRepeating, type PendingRow, type PendingRows } from "./pending";

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    done: false,
    project_id: 1,
    created: "2026-09-01T10:00:00Z",
    updated: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

const pendingMap = (...rows: PendingRow[]): PendingRows =>
  new Map(rows.map((row) => [row.task.id, row]));

describe("applyPending", () => {
  it("returns the very same array when nothing is pending", () => {
    const tasks = [task(1), task(2)];
    expect(applyPending(tasks, new Map())).toBe(tasks);
  });

  it("marks a lingering task done in place, so the checkbox fills at once", () => {
    const tasks = [task(1), task(2), task(3)];
    const result = applyPending(
      tasks,
      pendingMap({ task: task(2), kind: "completed", index: 1 }),
    );

    expect(result.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result[1]?.done).toBe(true);
    expect(result[0]?.done).toBe(false);
  });

  it("puts the row back when the poller has already dropped it", () => {
    // The poll runs every 20s and mergeUpserts asks view.belongs(), which is
    // false for a done task - so mid-linger the row can vanish from the cache
    // while the Undo is still on screen.
    const result = applyPending(
      [task(1), task(3)],
      pendingMap({ task: task(2), kind: "completed", index: 1 }),
    );

    expect(result.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result[1]?.done).toBe(true);
  });

  it("clamps the index when the list shrank underneath it", () => {
    const result = applyPending(
      [task(1)],
      pendingMap({ task: task(9), kind: "completed", index: 7 }),
    );
    expect(result.map((t) => t.id)).toEqual([1, 9]);
  });

  it("restores several rows in the order they sat in", () => {
    const result = applyPending(
      [task(5)],
      pendingMap(
        { task: task(3), kind: "completed", index: 2 },
        { task: task(1), kind: "completed", index: 0 },
      ),
    );
    expect(result.map((t) => t.id)).toEqual([1, 5, 3]);
  });

  it("leaves an advanced repeating task exactly as the server sent it", () => {
    // The server did not complete it: it moved due_date forward and returned
    // done:false. The row stays, and only the message is new.
    const tasks = [task(1, { due_date: "2026-09-17T18:00:00Z", repeat_after: 86400 })];
    const result = applyPending(
      tasks,
      pendingMap({
        task: tasks[0] as Task,
        kind: "advanced",
        index: 0,
        message: "Done. Next: 17 Sep",
      }),
    );

    expect(result).toBe(tasks);
    expect(result[0]?.done).toBe(false);
  });

  it("leaves a failed write showing the task as it still is", () => {
    const tasks = [task(1)];
    const result = applyPending(
      tasks,
      pendingMap({ task: tasks[0] as Task, kind: "failed", index: 0, message: "Nope" }),
    );

    expect(result).toBe(tasks);
    expect(result[0]?.done).toBe(false);
  });
});

describe("isRepeating", () => {
  it("is true for an interval", () => {
    expect(isRepeating({ repeat_after: 86400 })).toBe(true);
  });

  it("is true for the monthly mode even with no interval", () => {
    // Vikunja's own isRepeating() returns true for repeat_mode == Month
    // regardless of repeat_after, and setTaskDatesMonthRepeat ignores it.
    expect(isRepeating({ repeat_after: 0, repeat_mode: 1 })).toBe(true);
  });

  it("is false for a plain task, and for mode 2 with no interval", () => {
    // Mode 2 (from completion date) returns early when repeat_after is 0, so
    // the task really does just complete.
    expect(isRepeating({})).toBe(false);
    expect(isRepeating({ repeat_after: 0, repeat_mode: 2 })).toBe(false);
  });
});
