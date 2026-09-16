import { useQuery } from "@tanstack/react-query";
import { http } from "../api/client";
import {
  getInfo,
  getSavedFilter,
  getUser,
  listComments,
  listLabels,
  listProjects,
  listTasks,
  listViewTasks,
} from "../api/endpoints";
import type { Task } from "../api/types";
import type { ViewDef } from "../model/views";
import { queryKeys } from "./keys";

export function useInfo() {
  return useQuery({
    queryKey: queryKeys.info,
    queryFn: ({ signal }) => getInfo(http, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useUser() {
  return useQuery({
    queryKey: queryKeys.user,
    queryFn: ({ signal }) => getUser(http, signal),
    // A scoped API token can be refused here (403) while still reading tasks,
    // so callers must tolerate this failing.
    retry: false,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => listProjects(http, signal),
  });
}

export function useLabels() {
  return useQuery({
    queryKey: queryKeys.labels,
    queryFn: ({ signal }) => listLabels(http, signal),
  });
}

/**
 * One saved filter's query, so a filter is never adopted unread.
 *
 * `staleTime: Infinity` because a filter's query is edited in Vikunja's own UI
 * and effectively never during a session here; refetching it on a schedule
 * would be a request per view change to learn nothing.
 */
export function useSavedFilter(filterId: number | null) {
  return useQuery({
    queryKey: queryKeys.savedFilter(filterId ?? 0),
    enabled: filterId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) => getSavedFilter(http, filterId as number, signal),
  });
}

export function useViewTasks(view: ViewDef | null, timeZone: string) {
  return useQuery({
    queryKey: queryKeys.viewTasks(view?.key ?? "none"),
    enabled: view !== null,
    queryFn: ({ signal }): Promise<Task[]> => {
      if (!view) return Promise.resolve([]);
      const common = {
        filter: view.filter,
        includeNulls: view.includeNulls,
        timezone: timeZone,
        // The row's "n comments" badge. Absent without this - measured,
        // mapping §6 item 2.
        expand: "comment_count",
        ...(signal ? { signal } : {}),
      };
      // A view that knows its Vikunja view is read through it, because that
      // is the only listing that carries positions (§3). The flat listing is
      // what every view used before and what a view with no resolved id still
      // gets: same tasks, due-date order, no manual arrangement to lose.
      const source = view.positionSource;
      if (source) return listViewTasks(http, source.projectId, source.viewId, common);
      return listTasks(http, {
        ...common,
        sortBy: view.sortBy,
        orderBy: view.orderBy,
      });
    },
  });
}

/**
 * One task's comments.
 *
 * Its own key, outside the `tasks` predicate on purpose (see `keys.ts`), and
 * only fetched while a dialog is open on that task.
 */
export function useTaskComments(taskId: number | null) {
  return useQuery({
    queryKey: queryKeys.taskComments(taskId ?? 0),
    enabled: taskId !== null,
    queryFn: ({ signal }) =>
      taskId === null ? Promise.resolve([]) : listComments(http, taskId, signal),
  });
}
