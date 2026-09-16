/**
 * Where a reordered task lands, in Vikunja's per-view position space.
 *
 * Mapping §3: positions are `float64` stored per `(task, project_view)`, and
 * an insertion takes the midpoint of its neighbours. This module is the single
 * place that arithmetic exists — a second copy of it would be a second opinion
 * about the server.
 *
 * One of §3's rules did not survive contact with a real instance: see
 * MIN_POSITION_SPACING below and mapping §6 item 23.
 *
 * Nothing here talks to the network. It is deliberately pure so the one part
 * of the ordering slice that can be reasoned about exactly is also the part
 * that is tested exactly; the rest needs a real instance.
 */

/**
 * Vikunja's `MinPositionSpacing`.
 *
 * §3 read this off `main` as a server-side guard: a write leaving a gap below
 * it was supposed to make the server renumber the whole view. Measured against
 * `pinguino` v2.5.0 it does no such thing (§6 item 23) — a position written
 * 0.001 from its neighbour was stored verbatim and nothing else moved. The
 * recalculation is the CLIENT'S, which is what Vikunja's own
 * `calculateItemPosition.ts` always was.
 *
 * So nothing on the server stops positions converging. Halving a gap 21 times
 * from the starting spacing of 2^16 reaches this value, and past it two tasks
 * share a float and the view falls back to id order. `positionForMove` reports
 * it rather than refusing, because the repair is the caller's to schedule.
 */
export const MIN_POSITION_SPACING = 0.01;

/** What Vikunja adds when a task is appended to the end of a view. */
const TAIL_STEP = 2 ** 16;

/** Only the two fields the arithmetic needs; the callers pass whole tasks. */
export interface Positioned {
  id: number;
  /** Absent when the task was never read through a view endpoint (§3). */
  position?: number;
}

export interface Move {
  taskId: number;
  position: number;
  /**
   * True when the computed value crowds a neighbour past MIN_POSITION_SPACING.
   *
   * The write still succeeds and still lands where the user dropped it — this
   * is not an error. It says the VIEW now needs renumbering, which no one else
   * will do (§6 item 23), and that re-reading alone would not help: the same
   * crowded numbers would come back and the next drop would halve them again.
   */
  needsRenumber: boolean;
}

/**
 * The value that sits between two neighbours, each branch straight from §3.
 *
 * `undefined` means "no neighbour on that side", which is not the same as a
 * neighbour at 0 — a real 0 is what an empty view's first task gets.
 */
export function positionBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) / 2;
  if (after === undefined) return before + TAIL_STEP;
  // Equal neighbours are a conflict, not a midpoint: the midpoint IS their
  // value, and tasks sharing a position fall back to id order, which is not
  // where the drop happened.
  if (before === after) return after + MIN_POSITION_SPACING;
  return before + (after - before) / 2;
}

/** A gap too small to keep halving. */
function crowds(position: number, neighbour: number | undefined): boolean {
  if (neighbour === undefined) return false;
  return Math.abs(position - neighbour) < MIN_POSITION_SPACING;
}

/**
 * The single position write a move implies, or null when there is nothing
 * honest to write.
 *
 * The neighbours are read AFTER the moved task is lifted out of the list, so
 * moving down and moving up are not symmetric: dragging index 0 to index 1
 * lands between the tasks that were at 1 and 2, while dragging index 3 to
 * index 1 lands between those that were at 0 and 1. Computing neighbours
 * against the original array is the off-by-one this function exists to stop.
 */
export function positionForMove(
  list: readonly Positioned[],
  fromIndex: number,
  toIndex: number,
): Move | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= list.length) return null;
  if (toIndex < 0 || toIndex >= list.length) return null;

  const moved = list[fromIndex];
  if (!moved) return null;
  // A task the incremental poll produced carries no position (reconcile.ts
  // deletes it rather than zeroing it, since a flat GET cannot express a real
  // 0). We do not know where it currently sits in the view's space, so any
  // number we sent would be a guess dressed as a measurement.
  if (moved.position === undefined) return null;

  const remaining = list.filter((_, index) => index !== fromIndex);
  const before = remaining[toIndex - 1]?.position;
  const after = remaining[toIndex]?.position;

  const position = positionBetween(before, after);
  return {
    taskId: moved.id,
    position,
    needsRenumber: crowds(position, before) || crowds(position, after),
  };
}
