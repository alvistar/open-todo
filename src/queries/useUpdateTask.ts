import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../api/client";
import type { TaskOverrides, TaskPatch } from "../api/endpoints";
import {
  addLabel,
  createComment,
  createLabel,
  getTask,
  removeLabel,
  updateReminders,
  updateTask,
} from "../api/endpoints";
import type { Task, TaskComment, TaskReminder } from "../api/types";
import type { LabelChange } from "../ui/detail/pickers";
import { queryKeys } from "./keys";

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

/**
 * Puts a label on a task, or takes one off.
 *
 * Labels are a sub-resource, so this is not a task write at all and cannot
 * ride along with one. The call answers with the relation rather than the
 * task, so the updated copy is READ BACK - the dialog and the row behind it
 * both render from the cached task, and without the re-read they would show
 * the old label set until the next poll.
 */
export function useTaskLabel() {
  const queryClient = useQueryClient();

  return useMutation<Task, Error, { task: Task; change: LabelChange }>({
    mutationFn: async ({ task, change }) => {
      if ("create" in change) {
        // Create THEN attach: a label that exists but is on no task is a mess
        // the user can see and delete, which is better than a failed attach
        // leaving them wondering whether the name was taken.
        const created = await createLabel(http, change.create);
        await addLabel(http, task.id, created.id);
      } else if (change.attached) {
        await addLabel(http, task.id, change.labelId);
      } else {
        await removeLabel(http, task.id, change.labelId);
      }
      return getTask(http, task.id);
    },
    onSuccess: (updated, { change }) => {
      writeBack(queryClient, updated);
      // A new label changes the instance, not just this task, so the list the
      // picker chooses from has to be refetched as well.
      if ("create" in change) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      }
    },
  });
}

/**
 * Adds a comment.
 *
 * Two invalidations, not one: the comment list under its own key, and the task
 * lists for the `comment_count` the row badge reads. They are separate keys on
 * purpose, so completing a task does not refetch every comment thread.
 */
export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation<TaskComment, Error, { taskId: number; comment: string }>({
    mutationFn: ({ taskId, comment }) => createComment(http, taskId, comment),
    onSuccess: (_created, { taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.taskComments(taskId),
      });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "tasks",
      });
    },
  });
}
