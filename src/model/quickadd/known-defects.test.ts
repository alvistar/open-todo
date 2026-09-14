import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "./parse";

/*
 * EVERY ASSERTION IN THIS FILE PINS BEHAVIOUR THAT IS WRONG.
 *
 * These are the defects still open from the six found by running the quick-add
 * parser against a 4325-phrase corpus (research-external/corpus/FINDINGS.md).
 * They are written down first, as tests that pass, for one reason: a refactor
 * was about to move this code, and a defect nobody has pinned is a defect that
 * can quietly change shape mid-refactor and be re-discovered later as something
 * new.
 *
 * ALL SIX ARE NOW FIXED, and none of them lives here any more. Their cases
 * moved to the ordinary suite: `recurrence.test.ts` for the rule,
 * `parse.test.ts` for the whole line.
 *
 * What is left is F7, which is not a corpus finding at all - it is a limitation
 * the F4 fix introduced knowingly, written down here rather than discovered
 * later. The file keeps its rule: what is pinned below is WRONG, and the commit
 * that fixes it flips the block.
 *
 * So the rule for this file is the opposite of every other test here:
 *
 *   - While refactoring, these must KEEP PASSING. A failure means the refactor
 *     changed behaviour it promised not to touch - even if it changed it for
 *     the better.
 *   - The commit that FIXES a finding flips its block, deletes the "today"
 *     assertions, and moves the case into the ordinary suite. Each fix is a §5
 *     grammar amendment: it needs a docs/data-model-mapping.md §5.1 edit and the
 *     owner's sign-off, not a drive-by correction.
 *
 * Where a defect has a working counterpart, the counterpart is pinned beside it.
 * That is what stops a refactor from "fixing" one half by accident and leaving
 * the pair inconsistent without anything going red.
 */

const TZ = "Europe/Rome";
// Wednesday 9 September 2026, 10:00 in Rome.
const NOW = new Date("2026-09-09T08:00:00Z");

const ctx = (): QuickAddContext => ({
  now: NOW,
  timeZone: TZ,
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [{ id: 1, title: "Inbox" }],
  labels: [],
});

const parse = (text: string) => parseQuickAdd(text, ctx());

describe("F8 — an adverb ENDING the line is a schedule, whatever it modifies", () => {
  /*
   * What is left of F8 after requiring the adverb to end the schedule. That
   * rule removed the cases where something followed - "a weekly report from the
   * vendor", "the medicine is taken daily by the patient" - and those are now
   * in the packs' inert corpus.
   *
   * This case is IRREDUCIBLE, and that is the point of pinning it. "disdire il
   * servizio pagato mensilmente" and "report mensilmente" are the same shape:
   * words, then an adverb, then the end of the line. One is a monthly task and
   * the other is a cancellation of a monthly service, and no syntax separates
   * them. §5 lists the bare adverb as an accepted form, so the only fix is to
   * withdraw that row - a grammar amendment, not a repair.
   */
  it("turns a cancellation into a monthly task", () => {
    const r = parse("disdire il servizio pagato mensilmente");
    expect(r.title).toBe("disdire il servizio pagato");
    expect(r.repeatAfter).toBe(30 * 24 * 60 * 60);
    expect(r.warnings).toEqual([]);
  });

  it("cannot be told apart from the form §5 accepts", () => {
    // Identical shape, and this one is exactly what the user meant.
    expect(parse("report mensilmente").repeatAfter).toBe(30 * 24 * 60 * 60);
  });
});
