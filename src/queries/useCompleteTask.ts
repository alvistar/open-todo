import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { http } from "../api/client";
import { updateTask } from "../api/endpoints";
import type { Task } from "../api/types";
import { useDraftSource } from "../lifecycle/drafts";
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
  /**
   * What the checkbox does: completes the task, or takes back a completion
   * that is still lingering. The caller does not have to know which, and must
   * not - a row drawn as done advertises "Reopen" and has to honour it.
   * `index` is where the row sits now, so it can be put back if it is dropped.
   */
  toggle: (task: Task, index: number) => void;
  undo: (taskId: number) => void;
  /** Forget everything, e.g. on navigation. */
  reset: () => void;
}

export function useCompleteTask(options: UseCompleteTaskOptions): CompleteTaskApi {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<number, PendingRow>>(new Map());
  const [inFlightCount, setInFlightCount] = useState(0);
  useDraftSource("task-completion", "Task completion", false, inFlightCount > 0);

  /*
   * The same map as the state, for the event handlers to read without being
   * rebuilt on every change. It is written only from event and timer callbacks,
   * never during render, so concurrent rendering cannot tear it.
   */
  const rows = useRef(new Map<number, PendingRow>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** Ids with a write on the wire right now. */
  const inFlight = useRef(new Set<number>());
  const live = useRef(true);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearTimer = useCallback((taskId: number) => {
    const timer = timers.current.get(taskId);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(taskId);
  }, []);

  const forget = useCallback(
    (taskId: number) => {
      clearTimer(taskId);
      if (!rows.current.delete(taskId)) return;
      if (live.current) setPending(new Map(rows.current));
    },
    [clearTimer],
  );

  const put = useCallback(
    (row: PendingRow, ttl: number) => {
      clearTimer(row.task.id);
      rows.current.set(row.task.id, row);
      if (live.current) setPending(new Map(rows.current));
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
      inFlight.current.add(task.id);
      if (live.current) setInFlightCount(inFlight.current.size);
      try {
        const updated = await updateTask(http, task, { done });

        if (!done) {
          forget(task.id);
        } else if (isRepeating(task)) {
          // The server did not complete it: `updateDone` ran the repeat_mode
          // handler, which put done back to false and moved the dates on. The
          // row carries the server's own copy from here, so it shows the new
          // date rather than the one the user was looking at.
          put(
            {
              task: updated,
              index,
              kind: "advanced",
              message: nextLabel(updated, optionsRef.current),
            },
            LINGER_MS,
          );
        } else {
          put({ task: updated, index, kind: "completed" }, LINGER_MS);
        }
        refreshTasks();
      } catch (error) {
        put(
          {
            task,
            index,
            kind: "failed",
            message: `Not saved: ${
              error instanceof Error ? error.message : "the change did not go through."
            }`,
          },
          FAILURE_MS,
        );
      } finally {
        inFlight.current.delete(task.id);
        if (live.current) setInFlightCount(inFlight.current.size);
      }
    },
    [put, forget, refreshTasks],
  );

  const undo = useCallback(
    (taskId: number) => {
      const row = rows.current.get(taskId);
      if (row?.kind !== "completed") return;
      forget(taskId);
      void write(row.task, row.index, false);
    },
    [forget, write],
  );

  const toggle = useCallback(
    (task: Task, index: number) => {
      // A second click while the write is on the wire is a double-click, not a
      // second intent - and it must be caught BEFORE the two branches below,
      // or a fast double-click on a plain task would complete it and then
      // immediately take that back.
      if (inFlight.current.has(task.id)) return;

      const current = rows.current.get(task.id);

      // The row is already drawn as done and says "Reopen": honour that.
      if (current?.kind === "completed") {
        undo(task.id);
        return;
      }
      // A click on a row that FAILED is the retry: clear the message, go again.
      if (current?.kind === "failed") clearTimer(task.id);
      // An `advanced` row has nothing to toggle; the server moved it on.
      if (current?.kind === "advanced") return;

      /*
       * A repeating task is never marked completed, not even for the length of
       * the round trip. The server will advance it rather than complete it, so
       * striking the row through would be a lie, and offering the Undo that
       * goes with a completed row would offer to restore a date that no longer
       * exists anywhere (D-write decision 5).
       */
      put(
        isRepeating(task)
          ? { task, index, kind: "advanced" }
          : { task, index, kind: "completed" },
        LINGER_MS,
      );
      void write(task, index, true);
    },
    [undo, put, write, clearTimer],
  );

  const reset = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    rows.current.clear();
    setPending(new Map());
  }, []);

  useEffect(() => {
    /*
     * Set on the way IN as well as cleared on the way out. StrictMode mounts,
     * unmounts and mounts again in development, so a flag that is only ever
     * cleared stays cleared for the life of the page - every pending row would
     * be dropped before it reached React state, and the linger with its Undo
     * would silently never appear. It worked in a production build and not in
     * `pnpm dev`, which is the only way this app is run today.
     */
    live.current = true;
    const running = timers.current;
    return () => {
      // A write can still be in flight when this unmounts; `live` is what stops
      // it landing on a dead component.
      live.current = false;
      for (const timer of running.values()) clearTimeout(timer);
      running.clear();
    };
  }, []);

  return { pending, toggle, undo, reset };
}

function nextLabel(task: Task, options: UseCompleteTaskOptions): string {
  const due = parseVikunjaDate(task.due_date);
  if (!due) return "Done. It repeats, so it stays.";
  const label = formatDueLabel(due, new Date(), options.timeZone, options.defaultDueTime);
  return `Done. Next: ${label}`;
}
