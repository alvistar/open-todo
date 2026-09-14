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
 * F1, F5 and F6 are FIXED and no longer live here. Their cases moved to the
 * ordinary suite: `recurrence.test.ts` for the rule, `parse.test.ts` for the
 * whole line.
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

describe("F3 — 'workday' is unknown where 'weekday' is understood", () => {
  it("drops 'every workday' silently", () => droppedInSilence("standup every workday"));

  it("but understands 'every weekday', and says it approximated", () => {
    // The counterpart. Two words for one idea, and only one is in the grammar.
    const r = parse("standup every weekday");
    expect(r.title).toBe("standup");
    expect(r.repeatAfter).toBe(7 * 24 * 60 * 60);
    expect(r.warnings.join(" ")).toMatch(/weekly/i);
  });
});

describe("F4 — a comma list of DAY NUMBERS is silent, where weekdays warn", () => {
  /*
   * The reject pattern needs a weekday on both sides of the comma, so "5,6"
   * matches nothing at all. Not an Italian asymmetry: both languages are silent
   * on digits and both warn on weekdays.
   */
  it("says nothing about the Italian digit list", () =>
    droppedInSilence("ogni 5,6 alle 15"));
  it("says nothing about the English digit list", () =>
    droppedInSilence("every 5,6 at 3pm"));

  it("but does warn about a weekday list", () => {
    const r = parse("standup every mon, wed");
    expect(r.title).toBe("standup every mon, wed");
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });
});
