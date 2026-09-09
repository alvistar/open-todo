import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { http } from "../api/client";
import { listTasks } from "../api/endpoints";
import { updatedSince, updatedWithinSeconds } from "../api/filter";
import type { Task } from "../api/types";
import { compareByDueDateThenId, type ViewDef } from "../model/views";
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
      fetchSince: (window, signal) =>
        listTasks(http, {
          filter:
            window.kind === "server-relative"
              ? updatedWithinSeconds(window.seconds)
              : updatedSince(window.since),
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
      if (event.type === "reset") {
        /*
         * The poller only follows the OPEN view, but the sidebar's Inbox and
         * Today counts are separate query keys that nothing else refetches
         * (TanStack's own polling and focus refetching are off, by design, so
         * it does not fight the poller). Without this they stayed frozen for
         * the whole session while the user sat on a project view. Piggy-backing
         * on the full fetch bounds their staleness to one full-fetch cadence.
         */
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "tasks" && query.queryKey[1] !== viewKey,
        });
      }

      queryClient.setQueryData<Task[]>(queryKey, (current = []) => {
        switch (event.type) {
          case "reset":
            return event.tasks;
          case "upsert": {
            const merged = mergeUpserts(current, event.tasks, (task) =>
              view.belongs(task, new Date(), timeZone),
            );
            // mergeUpserts appends newcomers; re-sort so a task created or
            // rescheduled elsewhere does not sit at the bottom of the list
            // until the next full fetch.
            return merged === current
              ? current
              : [...merged].sort(compareByDueDateThenId);
          }
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
