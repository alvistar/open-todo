import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { http } from "../api/client";
import { listTasks, listViewTasks } from "../api/endpoints";
import { updatedSince, updatedWithinSeconds } from "../api/filter";
import type { Task } from "../api/types";
import type { ViewDef } from "../model/views";
import { queryKeys } from "../queries/keys";
import { createPollingSource } from "./PollingSource";
import { carryViewPosition, mergeUpserts } from "./reconcile";

export interface UseLiveSourceOptions {
  /**
   * Asked before every event is applied. False means "leave the list alone" —
   * a reorder is on the wire, and a poll landing mid-write would show the
   * pre-move order for as long as it took the next tick to correct it, which
   * reads as the drag having been refused.
   *
   * Read through a ref inside the subscription, so changing it does not tear
   * down and restart the poller on every gesture.
   */
  apply?: () => boolean;
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
  apply,
}: UseLiveSourceOptions): void {
  const queryClient = useQueryClient();
  // Read through a ref so changing the callback does not restart polling.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const applyRef = useRef(apply);
  applyRef.current = apply;

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

      // The full fetch is the only one that can read positions, so a view
      // that has an order reads it here - and this is what repairs the cache
      // after a reorder made on another device, or after our own optimistic
      // guess turned out not to be what the server stored.
      fetchAll: (signal) => {
        const source = view.positionSource;
        if (source) {
          return listViewTasks(http, source.projectId, source.viewId, {
            filter: view.filter,
            includeNulls: view.includeNulls,
            timezone: timeZone,
            ...(signal ? { signal } : {}),
          });
        }
        return listTasks(http, {
          filter: view.filter,
          sortBy: view.sortBy,
          orderBy: view.orderBy,
          includeNulls: view.includeNulls,
          timezone: timeZone,
          ...(signal ? { signal } : {}),
        });
      },
    });

    const unsubscribe = source.subscribe((event) => {
      // Dropped, not queued: the next tick fetches again in at most one
      // interval, and a queued event would land after the write it was
      // supposed to lose to.
      if (applyRef.current?.() === false) return;

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
            const merged = mergeUpserts(
              current,
              event.tasks,
              (task) => view.belongs(task, new Date(), timeZone),
              // The incremental fetch is flat, so its copies carry no usable
              // position (mapping §3). Without this, editing a task anywhere
              // would move it to the top of a hand-arranged list.
              carryViewPosition,
            );
            // mergeUpserts appends newcomers; re-sort so a task created or
            // rescheduled elsewhere does not sit at the bottom of the list
            // until the next full fetch. The comparator is the view's own -
            // re-sorting a manually ordered list by due date was exactly how
            // this poll used to undo a reorder within one tick.
            return merged === current ? current : [...merged].sort(view.compare);
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
