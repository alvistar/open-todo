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
 * F1 and F3 to F6 are FIXED and no longer live here. Their cases moved to the
 * ordinary suite: `recurrence.test.ts` for the rule, `parse.test.ts` for the
 * whole line. F7 below is not a corpus finding at all - it is a limitation the
 * F4 fix introduced knowingly.
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

/** Neither a date, nor a repeat, nor a word of explanation. */
const droppedInSilence = (text: string) => {
  const r = parse(text);
  expect(r.title, text).toBe(text);
  expect(r.dueDate, text).toBeNull();
  expect(r.repeatAfter, text).toBeUndefined();
  expect(r.warnings, text).toEqual([]);
};

describe("F2 — 'every other <unit>' is dropped without a word", () => {
  /*
   * It means "every 2 <unit>", which IS supported, and §5.1 does not list it as
   * rejected. A vocabulary gap rather than a decision - and a silent one.
   */
  it("drops the English form", () => droppedInSilence("ping every other day"));
  it("drops the Italian form", () => droppedInSilence("ping ogni altro giorno"));
});

describe("F7 — an Italian decimal comma is read as a list of day numbers", () => {
  /*
   * NOT found by the corpus. Introduced knowingly by the F4 fix, and written
   * down here rather than discovered later.
   *
   * F4 taught the list rule that a day-of-month number is a list item, so
   * "ogni 5,6" is refused like "every mon, wed". Italian writes decimals with a
   * comma, so "corri ogni 1,5 km" now takes the same refusal. Nothing is lost -
   * the title is untouched and no date is set, exactly as before - but the
   * composer shows a warning about a repeat the user never wrote.
   *
   * Accepted because the alternatives are worse: a space after the comma does
   * not separate the two cases ("ogni 5,6" has none), and gating on a following
   * unit noun is guesswork. Zero occurrences in the 4325-record corpus. Revisit
   * if a real user hits it.
   */
  it("warns about a distance that is not a repeat", () => {
    const r = parse("corri ogni 1,5 km");
    expect(r.title).toBe("corri ogni 1,5 km");
    expect(r.dueDate).toBeNull();
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });
});
