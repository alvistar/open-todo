/*
 * The ordering arithmetic of mapping §3, pinned branch by branch.
 *
 * This is the only place in the app that decides what number a moved task
 * gets, and every one of its rules comes from Vikunja's own
 * `calculateItemPosition.ts` — so a change here is a claim about the server,
 * not a refactor. The two rules worth staring at are that neighbours are taken
 * AFTER the moved task is lifted out (which makes up and down asymmetric), and
 * that a gap under MinPositionSpacing does not fail: the server silently
 * renumbers the whole view, so the caller has to re-read.
 */
import { describe, expect, it } from "vitest";
import { MIN_POSITION_SPACING, positionBetween, positionForMove } from "./position";

describe("positionBetween", () => {
  it("takes the midpoint between two neighbours", () => {
    expect(positionBetween(4, 8)).toBe(6);
  });

  it("halves the follower when there is nothing above", () => {
    expect(positionBetween(undefined, 8)).toBe(4);
  });

  it("adds 2^16 to the leader when there is nothing below", () => {
    expect(positionBetween(8, undefined)).toBe(8 + 65536);
  });

  it("is 0 in an empty list", () => {
    expect(positionBetween(undefined, undefined)).toBe(0);
  });

  it("steps past equal neighbours rather than landing on them", () => {
    // Vikunja's conflict branch. Returning the midpoint here would be the
    // neighbours' own value, and two tasks sharing a position order by id —
    // which is not where the user dropped it.
    expect(positionBetween(5, 5)).toBe(5 + MIN_POSITION_SPACING);
  });

  it("halves towards zero rather than going negative at the top", () => {
    expect(positionBetween(undefined, 0.5)).toBe(0.25);
  });
});

describe("positionForMove", () => {
  const list = [
    { id: 1, position: 10 },
    { id: 2, position: 20 },
    { id: 3, position: 30 },
    { id: 4, position: 40 },
  ];

  it("refuses a move that goes nowhere", () => {
    expect(positionForMove(list, 2, 2)).toBeNull();
  });

  it("refuses an index outside the list", () => {
    expect(positionForMove(list, 0, 9)).toBeNull();
    expect(positionForMove(list, -1, 2)).toBeNull();
  });

  it("refuses to move a task whose position we have never read", () => {
    // A task the incremental poll produced carries no position (reconcile.ts
    // deletes it rather than zeroing it). Moving a NEIGHBOUR past it is fine;
    // moving IT is a write we cannot compute an honest number for.
    const withNewcomer = [...list, { id: 5 }];
    expect(positionForMove(withNewcomer, 4, 0)).toBeNull();
  });

  it("puts a task dragged to the top above everything", () => {
    const move = positionForMove(list, 3, 0);
    expect(move).toMatchObject({ taskId: 4, position: 5 });
  });

  it("puts a task dragged to the bottom below everything", () => {
    const move = positionForMove(list, 0, 3);
    expect(move).toMatchObject({ taskId: 1, position: 40 + 65536 });
  });

  it("takes neighbours after lifting the task out, moving DOWN", () => {
    // 1 moves from index 0 to index 1. Once it is lifted the list is
    // [2,3,4], so its neighbours at index 1 are 2 and 3 — not 1 and 2.
    const move = positionForMove(list, 0, 1);
    expect(move).toMatchObject({ taskId: 1, position: 25 });
  });

  it("takes neighbours after lifting the task out, moving UP", () => {
    // 4 moves from index 3 to index 1. Lifted, the list is [1,2,3]; at
    // index 1 the neighbours are 1 and 2. The asymmetry with the case above
    // is the whole reason this function exists rather than a one-liner.
    const move = positionForMove(list, 3, 1);
    expect(move).toMatchObject({ taskId: 4, position: 15 });
  });

  it("treats a neighbour with no position as no neighbour", () => {
    // The newcomer sorts last anyway, so landing above it is satisfied by any
    // value; what must not happen is arithmetic on undefined.
    const trailing = [{ id: 1, position: 10 }, { id: 2, position: 20 }, { id: 3 }];
    const move = positionForMove(trailing, 0, 1);
    expect(move).toMatchObject({ taskId: 1, position: 20 + 65536 });
  });

  it("does not expect a renumber when the gaps are wide", () => {
    expect(positionForMove(list, 0, 1)?.willRenumber).toBe(false);
  });

  it("expects a renumber when a gap falls below the spacing", () => {
    const crowded = [
      { id: 1, position: 10 },
      { id: 2, position: 10.001 },
      { id: 3, position: 30 },
    ];
    // 3 lands between two tasks 0.001 apart: the halves are 0.0005, well
    // under the spacing, so the server rewrites the view and the value we
    // computed is not the value that will be stored.
    expect(positionForMove(crowded, 2, 1)?.willRenumber).toBe(true);
  });

  it("errs towards expecting a renumber at the spacing boundary", () => {
    // Neighbours 0.02 apart put the midpoint 0.01 from each — nominally the
    // boundary, which Vikunja compares as "below". In binary that subtraction
    // is 0.00999999999999978, so the boundary case is decided by float noise
    // and cannot be pinned either way honestly.
    //
    // It is pinned as TRUE deliberately, because the two errors are not equal:
    // a spurious `true` costs one re-read of a list we already have, while a
    // spurious `false` leaves the cache holding a position the server has
    // since rewritten, and every later move computes against that stale value.
    const spaced = [
      { id: 1, position: 10 },
      { id: 2, position: 10 + 2 * MIN_POSITION_SPACING },
      { id: 3, position: 30 },
    ];
    expect(positionForMove(spaced, 2, 1)?.willRenumber).toBe(true);
  });

  it("does not expect a renumber a decimal order away from the boundary", () => {
    const spaced = [
      { id: 1, position: 10 },
      { id: 2, position: 10 + 20 * MIN_POSITION_SPACING },
      { id: 3, position: 30 },
    ];
    expect(positionForMove(spaced, 2, 1)?.willRenumber).toBe(false);
  });

  it("expects a renumber after the equal-neighbours step", () => {
    // before === after means the 0.01 branch fired, which leaves exactly zero
    // gap on one side: whatever we send, the server is going to restate it.
    const tied = [
      { id: 1, position: 5 },
      { id: 2, position: 5 },
      { id: 3, position: 30 },
    ];
    expect(positionForMove(tied, 2, 1)?.willRenumber).toBe(true);
  });
});
