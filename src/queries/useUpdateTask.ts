import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../api/client";
import type { TaskOverrides, TaskPatch } from "../api/endpoints";
import { updateTask } from "../api/endpoints";
import type { Task } from "../api/types";

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

    onSuccess: (updated) => {
      /*
       * Put the server's own copy into every cached view that already holds
       * this task, so the dialog and the row behind it change in the same
       * frame, and only then reconcile. Without the first step the open
       * dialog would show the old value until a refetch landed - it reads the
       * task out of the view's list, on purpose.
       */
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
    },
  });
}
