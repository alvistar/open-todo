/*
 * The ordering arithmetic of mapping §3, pinned branch by branch.
 *
 * This is the only place in the app that decides what number a moved task
 * gets, and every one of its rules comes from Vikunja's own
 * `calculateItemPosition.ts` — so a change here is a claim about the server,
 * not a refactor. The two rules worth staring at are that neighbours are taken
 * AFTER the moved task is lifted out (which makes up and down asymmetric), and
 * that a gap under MinPositionSpacing does not fail — and, since `pinguino`
 * turned out not to renumber anything (mapping §6 item 23), leaves the view
 * for the CLIENT to repair.
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

  it("looks past a positionless task for the neighbour that has one", () => {
    // The newcomer sorts last anyway, so landing above it is satisfied by any
    // value; what must not happen is arithmetic on undefined.
    const trailing = [{ id: 1, position: 10 }, { id: 2, position: 20 }, { id: 3 }];
    const move = positionForMove(trailing, 0, 1);
    expect(move).toMatchObject({ taskId: 1, position: 20 + 65536 });
  });

  it("sends a task dropped at the BOTTOM to the bottom, not the top", () => {
    /*
     * The one a review caught, and the worst kind: it did the opposite of the
     * gesture, silently, and persisted it.
     *
     * A task the incremental poll produced has no position, and the comparator
     * parks it at the tail — so the last slot's neighbours were BOTH read as
     * "absent", `positionBetween(undefined, undefined)` took its empty-list
     * branch, and the answer was 0. Zero sorts FIRST. Dragging a row to the
     * bottom put it at the top of the view and wrote that to the server, with
     * `needsRenumber: false` so nothing ever repaired it.
     *
     * The existing positionless test hid it by moving to index 1, which takes
     * the `before + 2^16` branch.
     */
    const withNewcomer = [{ id: 1, position: 10 }, { id: 2, position: 20 }, { id: 3 }];
    const move = positionForMove(withNewcomer, 0, 2);
    expect(move?.position).toBe(20 + 65536);
    expect(move?.position).toBeGreaterThan(20);
  });

  it("finds the neighbour above even with several positionless tasks between", () => {
    const many = [{ id: 1, position: 10 }, { id: 2, position: 20 }, { id: 3 }, { id: 4 }];
    expect(positionForMove(many, 0, 3)?.position).toBe(20 + 65536);
  });

  it("does not expect a renumber when the gaps are wide", () => {
    expect(positionForMove(list, 0, 1)?.needsRenumber).toBe(false);
  });

  it("expects a renumber when a gap falls below the spacing", () => {
    const crowded = [
      { id: 1, position: 10 },
      { id: 2, position: 10.001 },
      { id: 3, position: 30 },
    ];
    // 3 lands between two tasks 0.001 apart: the halves are 0.0005, well
    // under the spacing. The write succeeds and the order is right; what is
    // wrong is the view, which has run out of room to subdivide.
    expect(positionForMove(crowded, 2, 1)?.needsRenumber).toBe(true);
  });

  it("expects a renumber for a genuinely tight gap, at any magnitude", () => {
    /*
     * A gap comfortably under the spacing, checked at three magnitudes because
     * that is what a review showed to matter: the comparison used to be a
     * strict `<` against a midpoint distance, and above ~10^5 a float's own
     * error is a measurable fraction of 0.01.
     *
     * The EXACT boundary is deliberately not pinned. At 10^6, `base + 0.02` is
     * not 0.02 above base — the nearest representable value is 0.0200000000186
     * above it — so the halves really do exceed the spacing and declining to
     * renumber is correct, not a miss. It costs one further halving before the
     * repair fires, which is the right side to be wrong on.
     */
    for (const base of [10, 131072, 1_000_000]) {
      const tight = [
        { id: 1, position: base },
        { id: 2, position: base + 0.001 },
        { id: 3, position: base * 3 },
      ];
      expect(positionForMove(tight, 2, 1)?.needsRenumber).toBe(true);
    }
  });

  it("does not expect a renumber a decimal order away from the boundary", () => {
    const spaced = [
      { id: 1, position: 10 },
      { id: 2, position: 10 + 20 * MIN_POSITION_SPACING },
      { id: 3, position: 30 },
    ];
    expect(positionForMove(spaced, 2, 1)?.needsRenumber).toBe(false);
  });

  it("expects a renumber after the equal-neighbours step, at any magnitude", () => {
    /*
     * A tie is reported unconditionally rather than left to the gap
     * arithmetic. Two reasons, and the second is the one that matters: the
     * 0.01 step lands the task just BELOW the neighbour it was dropped above,
     * so the order the user asked for cannot be expressed at all until the
     * view is spread out again. Until this was made unconditional, a tie at
     * 131072 reported false and the row silently reverted on the next poll.
     */
    for (const base of [0, 5, 131072]) {
      const tied = [
        { id: 1, position: base },
        { id: 2, position: base },
        { id: 3, position: base + 1000 },
      ];
      expect(positionForMove(tied, 2, 1)?.needsRenumber).toBe(true);
    }
  });
});
