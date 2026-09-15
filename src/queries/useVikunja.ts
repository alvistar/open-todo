import { useQuery } from "@tanstack/react-query";
import { http } from "../api/client";
import {
  getInfo,
  getUser,
  listComments,
  listLabels,
  listProjects,
  listTasks,
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

export function useViewTasks(view: ViewDef | null, timeZone: string) {
  return useQuery({
    queryKey: queryKeys.viewTasks(view?.key ?? "none"),
    enabled: view !== null,
    queryFn: ({ signal }): Promise<Task[]> => {
      if (!view) return Promise.resolve([]);
      return listTasks(http, {
        filter: view.filter,
        sortBy: view.sortBy,
        orderBy: view.orderBy,
        includeNulls: view.includeNulls,
        timezone: timeZone,
        // The row's "n comments" badge. Absent without this - measured,
        // mapping §6 item 2.
        expand: "comment_count",
        ...(signal ? { signal } : {}),
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
