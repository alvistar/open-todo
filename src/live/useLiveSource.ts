import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { http } from "../api/client";
import { listTasks } from "../api/endpoints";
import { updatedSince } from "../api/filter";
import type { Task } from "../api/types";
import type { ViewDef } from "../model/views";
import { queryKeys } from "../queries/keys";
import { createPollingSource } from "./PollingSource";
import { mergeUpserts } from "./reconcile";

export interface UseLiveSourceOptions {
  view: ViewDef | null;
  timeZone: string;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

/**
 * Keeps one view's query cache entry fresh from a LiveSource (D6).
 *
 * The source is rebuilt when the view changes, because "what belongs in the
 * view" is part of how an incremental result is interpreted.
 */
export function useLiveSource({
  view,
  timeZone,
  enabled = true,
  onError,
}: UseLiveSourceOptions): void {
  const queryClient = useQueryClient();
  // Read through a ref so changing the callback does not restart polling.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const viewKey = view?.key ?? null;

  useEffect(() => {
    if (!enabled || !view || !viewKey) return;

    const queryKey = queryKeys.viewTasks(viewKey);
    const read = (): Task[] => queryClient.getQueryData<Task[]>(queryKey) ?? [];

    const source = createPollingSource({
      getCurrent: read,
      onError: (error) => onErrorRef.current?.(error),

      // Deliberately NOT scoped by the view's filter. A task that just LEFT
      // the view — completed, moved, rescheduled — no longer matches that
      // filter, so ANDing it in would make the incremental fetch structurally
      // blind to exactly the change the user most wants to see, leaving it to
      // the every-fifth-tick full fetch ~100s later. `updated >= since` alone
      // returns the handful of tasks touched in the last interval, and
      // mergeUpserts asks view.belongs() which of them to add and which to
      // drop. Verified: without this, completing a task elsewhere took a full
      // fetch to disappear; with it, one interval.
      fetchSince: (since, signal) =>
        listTasks(http, {
          filter: updatedSince(since),
          timezone: timeZone,
          ...(signal ? { signal } : {}),
        }),

      fetchAll: (signal) =>
        listTasks(http, {
          filter: view.filter,
          sortBy: view.sortBy,
          orderBy: view.orderBy,
          includeNulls: view.includeNulls,
          timezone: timeZone,
          ...(signal ? { signal } : {}),
        }),
    });

    const unsubscribe = source.subscribe((event) => {
      queryClient.setQueryData<Task[]>(queryKey, (current = []) => {
        switch (event.type) {
          case "reset":
            return event.tasks;
          case "upsert":
            return mergeUpserts(current, event.tasks, (task) =>
              view.belongs(task, new Date(), timeZone),
            );
          case "delete": {
            const removed = new Set(event.ids);
            return current.filter((task) => !removed.has(task.id));
          }
        }
      });
    });

    source.start();
    return () => {
      unsubscribe();
      source.stop();
    };
  }, [queryClient, view, viewKey, timeZone, enabled]);
}
