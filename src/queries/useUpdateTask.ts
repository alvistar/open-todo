import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../api/client";
import type { TaskOverrides, TaskPatch } from "../api/endpoints";
import { updateReminders, updateTask } from "../api/endpoints";
import type { Task, TaskReminder } from "../api/types";

/**
 * Writes columns of one task.
 *
 * The task is always the copy the caller already holds, because `updateTask`
 * echoes reminders and assignees off it - see its contract. Reminders are
 * changed by naming them in `overrides`, never by handing over a doctored task.
 */

export interface UpdateTaskInput {
  task: Task;
  values: TaskPatch;
  overrides?: TaskOverrides;
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, Error, UpdateTaskInput>({
    mutationFn: ({ task, values, overrides }) =>
      updateTask(http, task, values, overrides ?? {}),

    onSuccess: (updated) => writeBack(queryClient, updated),
  });
}

/**
 * Puts the server's own copy into every cached view that already holds this
 * task, so the dialog and the row behind it change in the same frame, and only
 * then reconciles. Without the first step the open dialog would show the old
 * value until a refetch landed - it reads the task out of the view's list, on
 * purpose.
 */
function writeBack(queryClient: QueryClient, updated: Task): void {
  queryClient.setQueriesData<Task[]>(
    { predicate: (query) => query.queryKey[0] === "tasks" },
    (current) =>
      current?.some((task) => task.id === updated.id)
        ? current.map((task) => (task.id === updated.id ? updated : task))
        : current,
  );
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "tasks",
  });
}

/**
 * Replaces a task's reminders.
 *
 * Its own hook, and its own endpoint, because reminders are not a column:
 * `updateReminders` has to name one anyway, and the reason it picks `title` is
 * a measurement that belongs next to the call rather than hidden in a flag on
 * this one.
 */
export function useUpdateReminders() {
  const queryClient = useQueryClient();

  return useMutation<Task, Error, { task: Task; reminders: TaskReminder[] }>({
    mutationFn: ({ task, reminders }) => updateReminders(http, task, reminders),
    onSuccess: (updated) => writeBack(queryClient, updated),
  });
}
