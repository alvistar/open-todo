import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { http } from "../api/client";
import { listViewTasks, setTaskPosition } from "../api/endpoints";
import type { Task } from "../api/types";
import { type Move, positionForMove } from "../model/position";
import type { ViewDef } from "../model/views";
import { queryKeys } from "./keys";

/** The spacing a freshly renumbered view gets, matching Vikunja's own. */
const RENUMBER_STEP = 2 ** 16;

export interface ReorderApi {
  /** False when the view has no position space, so no handle may be drawn. */
  reorderable: boolean;
  /**
   * Put `taskId` where `overId` currently sits.
   *
   * Ids, not indices, and deliberately so: the rendered list is not the cached
   * array. The cache also holds sub-tasks, which are shown under their parent
   * and nowhere else, and rows lingering after a completion — so a rendered
   * index means nothing here. It is also exactly dnd-kit's `active`/`over`
   * pair, so the drop handler and the keyboard binding share one contract.
   *
   * Resolving against the cache is more correct, not merely safer: a hidden
   * sub-task sitting between two visible rows still occupies the view's
   * position space, and the midpoint has to account for it.
   */
  reorder: (taskId: number, overId: number) => void;
  /** Why the last move did not stick, or null. */
  error: string | null;
  /** True while a write is on the wire, so the poll can leave the list alone. */
  isMoving: () => boolean;
}

interface Variables {
  move: Move;
  fromIndex: number;
  toIndex: number;
}

/** Applies a move to an array the way the server will, position included. */
function reordered(tasks: Task[], vars: Variables): Task[] {
  const next = [...tasks];
  const [moved] = next.splice(vars.fromIndex, 1);
  if (!moved) return tasks;
  // The position matters as much as the index: the cached array is re-sorted
  // by the view's comparator after every poll merge, so an array reordered
  // without its positions updated snaps back on the next tick.
  next.splice(vars.toIndex, 0, { ...moved, position: vars.move.position });
  return next;
}

/**
 * Moves a task inside a view's manual order (mapping §3).
 *
 * Two deliberate absences.
 *
 * It never calls `invalidateQueries`. Every other mutation here does, but a
 * refetch that lands before the server has stored the new position renders the
 * OLD order, which reads as the drag having been rejected. This hook owns the
 * array instead: it writes the authoritative one itself.
 *
 * And a failure is not routed through `useCompleteTask`'s pending rows. That
 * map means "you just completed this, here is an Undo"; a failed move has
 * nothing to undo, and borrowing the channel would offer one.
 */
export function useReorderTask(view: ViewDef | null): ReorderApi {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const source = view?.positionSource;
  const queryKey = queryKeys.viewTasks(view?.key ?? "none");

  const mutation = useMutation({
    mutationFn: async ({ move }: Variables): Promise<Task[] | null> => {
      if (!source) throw new Error("This list has no order to write to.");
      await setTaskPosition(http, move.taskId, source.viewId, move.position);
      if (!move.needsRenumber) return null;

      /*
       * §6 item 23: the server does NOT renumber a crowded view, contrary to
       * what mapping §3 said before it was measured. So the client does, or
       * the gaps keep halving until two tasks share a float and the order
       * silently falls back to id.
       *
       * One request per task, because there is no batch position route (§3),
       * and sequentially so the view is never half-renumbered in a way a
       * concurrent read could observe as scrambled.
       */
      const current = queryClient.getQueryData<Task[]>(queryKey) ?? [];
      for (const [index, task] of current.entries()) {
        await setTaskPosition(http, task.id, source.viewId, (index + 1) * RENUMBER_STEP);
      }
      // Re-read rather than assume: what we just wrote is the authority, and
      // the optimistic copies are not.
      return listViewTasks(http, source.projectId, source.viewId, {
        filter: view?.filter ?? "",
        includeNulls: view?.includeNulls ?? false,
        expand: "comment_count",
      });
    },

    onMutate: async (vars: Variables) => {
      inFlight.current = true;
      setError(null);
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      queryClient.setQueryData<Task[]>(queryKey, (current = []) =>
        reordered(current, vars),
      );
      /*
       * Cancelled AFTER the optimistic write, not before it.
       *
       * The usual recipe cancels first, but `cancelQueries` awaits whatever
       * fetch is in flight — and this runs on a gesture, so awaiting it would
       * hold the row still until the network answered, which is the one thing
       * a drag may never do. Everything above here is synchronous, so the list
       * moves in the same frame; the cancel still stops a refetch that has not
       * landed yet from replacing the array with the pre-move order.
       */
      await queryClient.cancelQueries({ queryKey });
      return { previous };
    },

    onError: (cause, _vars, context) => {
      inFlight.current = false;
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Not moved: ${message}`);
    },

    onSuccess: (fresh) => {
      inFlight.current = false;
      if (fresh) queryClient.setQueryData<Task[]>(queryKey, fresh);
    },
  });

  const { mutate } = mutation;

  const reorder = useCallback(
    (taskId: number, overId: number) => {
      if (!source) return;
      const current = queryClient.getQueryData<Task[]>(queryKey) ?? [];
      const fromIndex = current.findIndex((task) => task.id === taskId);
      const toIndex = current.findIndex((task) => task.id === overId);
      if (fromIndex < 0 || toIndex < 0) return;
      // Computed here rather than in onMutate so that a move with nothing to
      // write - the same slot, an unplaceable task - costs no mutation and
      // leaves no error on screen.
      const move = positionForMove(current, fromIndex, toIndex);
      if (!move) return;
      mutate({ move, fromIndex, toIndex });
    },
    [mutate, queryClient, queryKey, source],
  );

  const isMoving = useCallback(() => inFlight.current, []);

  return { reorderable: source !== undefined, reorder, error, isMoving };
}
