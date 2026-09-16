import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../api/client";
import { deleteTask } from "../api/endpoints";
import type { Task } from "../api/types";

/**
 * Deletes a task. The one write in this app with no way back.
 *
 * Measured on `pinguino` (§6 item 31): `DELETE /tasks/{id}` answers 200, the
 * task then answers 404, and there is no restore route. So this offers no Undo
 * and must not appear to — re-creating the task would produce a DIFFERENT one,
 * with a new id and none of its comments, relations or position. That is the
 * plausible invented value D-write and D-vocab both refuse, and it is the whole
 * reason the affordance is guarded by a confirmation instead.
 *
 * Deliberately NOT optimistic, unlike every other write here. A failed
 * optimistic delete would have to put the row back, and the row it could put
 * back is the copy it happened to be holding — for the single irreversible
 * action, waiting for the server is the cheaper risk.
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, Task>({
    mutationFn: async (task) => {
      await deleteTask(http, task.id);
    },
    onSuccess: (_void, task) => {
      /*
       * Removed from EVERY cached list, not just the open view, and without an
       * invalidation to fall back on. A completion leaves a task the server
       * still has, so a cache this missed would be repaired by the next fetch;
       * a deletion leaves nothing to find. The sidebar counts are refreshed
       * separately below.
       */
      queryClient.setQueriesData<Task[]>(
        { predicate: (query) => query.queryKey[0] === "tasks" },
        (current) => current?.filter((held) => held.id !== task.id),
      );
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "tasks",
      });
    },
  });
}
