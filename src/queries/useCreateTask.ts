import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../api/client";
import { addLabel, createTask } from "../api/endpoints";
import type { Task } from "../api/types";
import type { QuickAddResult } from "../model/quickadd/parse";

/**
 * Creates the task a quick-add phrase describes.
 *
 * Labels are a sub-resource, so a task with labels is a create followed by one
 * PUT per label (mapping §2). A label that fails to attach does NOT fail the
 * whole thing: the task exists by then, and reporting "could not create" for a
 * task the user can see in the list would be a lie.
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, Error, QuickAddResult>({
    mutationFn: async (parsed) => {
      const projectId = parsed.effectiveProjectId;
      if (projectId === null) {
        throw new Error("No project to add this task to.");
      }
      if (!parsed.title.trim()) {
        throw new Error("A task needs a name.");
      }

      const task = await createTask(http, projectId, {
        title: parsed.title,
        // Only fields the phrase actually set are sent: a priority of 0 would
        // be a real write, not an absence.
        ...(parsed.dueDate ? { due_date: parsed.dueDate.toISOString() } : {}),
        ...(parsed.priority === null ? {} : { priority: parsed.priority }),
        ...(parsed.repeatAfter === undefined ? {} : { repeat_after: parsed.repeatAfter }),
        ...(parsed.repeatMode === undefined ? {} : { repeat_mode: parsed.repeatMode }),
      });

      for (const labelId of parsed.labelIds) {
        try {
          await addLabel(http, task.id, labelId);
        } catch {
          // The task is already created; a missing label is not worth losing it.
        }
      }

      return task;
    },

    onSuccess: () => {
      // Reconcile immediately rather than waiting for the next poll tick, and
      // refresh the sidebar counts along with the open view.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "tasks",
      });
    },
  });
}
