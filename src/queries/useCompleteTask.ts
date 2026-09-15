import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { http } from "../api/client";
import { updateTask } from "../api/endpoints";
import type { Task } from "../api/types";
import { formatDueLabel, parseVikunjaDate } from "../model/dates";
import { isRepeating, type PendingRow, type PendingRows } from "../model/pending";

/**
 * Completing and un-completing a task, with the short-lived row state that
 * D-write decided goes with it.
 *
 * Why the state lives here rather than in the query cache: a completed task
 * leaves every view this app has (all of them filter `done = false`), so there
 * is no cache entry left to hold "this one is still on screen with an Undo".
 * It is deliberately not persisted and is dropped when the view changes.
 */

/** How long a completed row stays on screen with its Undo. */
export const LINGER_MS = 6000;
/** A failed write says so for longer: the user has to read it. */
export const FAILURE_MS = 10_000;

export interface UseCompleteTaskOptions {
  timeZone: string;
  /** The user's Vikunja default_due_time, or null for D-map-2's 20:00. */
  defaultDueTime: string | null;
}

export interface CompleteTaskApi {
  pending: PendingRows;
  /** `index` is where the row sits now, so it can be put back if it is dropped. */
  complete: (task: Task, index: number) => void;
  undo: (taskId: number) => void;
  /** Forget everything, e.g. on navigation. */
  reset: () => void;
}

export function useCompleteTask(options: UseCompleteTaskOptions): CompleteTaskApi {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<number, PendingRow>>(new Map());

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Read the options through a ref so a re-render with a new `now` does not
  // have to rebuild the callbacks the list is holding.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearTimer = useCallback((taskId: number) => {
    const timer = timers.current.get(taskId);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(taskId);
  }, []);

  const forget = useCallback(
    (taskId: number) => {
      clearTimer(taskId);
      setPending((current) => {
        if (!current.has(taskId)) return current;
        const next = new Map(current);
        next.delete(taskId);
        return next;
      });
    },
    [clearTimer],
  );

  const put = useCallback(
    (row: PendingRow, ttl: number) => {
      clearTimer(row.task.id);
      setPending((current) => new Map(current).set(row.task.id, row));
      timers.current.set(
        row.task.id,
        setTimeout(() => forget(row.task.id), ttl),
      );
    },
    [clearTimer, forget],
  );

  /** Reconcile every view, including the sidebar counts (as useCreateTask does). */
  const refreshTasks = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "tasks",
    });
  }, [queryClient]);

  const write = useCallback(
    async (task: Task, index: number, done: boolean) => {
      try {
        const updated = await updateTask(http, task, { done });

        if (done && isRepeating(task)) {
          /*
           * The server did not complete it. `updateDone` ran the repeat_mode
           * handler, which set done back to false and moved the dates forward,
           * so the row stays where it is and says what happened. It gets no
           * Undo: the previous due date is gone and Vikunja keeps no history
           * of it, so "undoing" could only write back a date we guessed.
           */
          put(
            {
              task: updated,
              index,
              kind: "advanced",
              message: nextLabel(updated, optionsRef.current),
            },
            LINGER_MS,
          );
        } else if (done) {
          put({ task: updated, index, kind: "completed" }, LINGER_MS);
        } else {
          forget(task.id);
        }
        refreshTasks();
      } catch (error) {
        put(
          {
            task,
            index,
            kind: "failed",
            message:
              error instanceof Error ? error.message : "The change could not be saved.",
          },
          FAILURE_MS,
        );
      }
    },
    [put, forget, refreshTasks],
  );

  const complete = useCallback(
    (task: Task, index: number) => {
      // The row is drawn as done the moment it is clicked; a second click on
      // the same row while the write is in flight is a double-click, not a
      // second intent.
      if (timers.current.has(task.id)) return;
      timers.current.set(
        task.id,
        setTimeout(() => forget(task.id), LINGER_MS),
      );
      setPending((current) =>
        new Map(current).set(task.id, { task, index, kind: "completed" }),
      );
      void write(task, index, true);
    },
    [forget, write],
  );

  const undo = useCallback(
    (taskId: number) => {
      const row = pending.get(taskId);
      if (!row || row.kind !== "completed") return;
      forget(taskId);
      void write(row.task, row.index, false);
    },
    [pending, forget, write],
  );

  const reset = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setPending(new Map());
  }, []);

  // Timers outlive the component otherwise, and fire setState on a dead one.
  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running.values()) clearTimeout(timer);
      running.clear();
    };
  }, []);

  return { pending, complete, undo, reset };
}

function nextLabel(task: Task, options: UseCompleteTaskOptions): string {
  const due = parseVikunjaDate(task.due_date);
  if (!due) return "Done. It repeats, so it stays.";
  const label = formatDueLabel(due, new Date(), options.timeZone, options.defaultDueTime);
  return `Done. Next: ${label}`;
}
