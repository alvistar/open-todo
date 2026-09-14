import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "./parse";

/*
 * EVERY ASSERTION IN THIS FILE PINS BEHAVIOUR THAT IS WRONG.
 *
 * These are six defects found by running the quick-add parser against a
 * 4325-phrase corpus (research-external/corpus/FINDINGS.md). None of them is
 * fixed yet. They are written down first, as tests that pass, for one reason: a
 * refactor is about to move this code, and a defect nobody has pinned is a
 * defect that can quietly change shape mid-refactor and be re-discovered later
 * as something new.
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

const ymd = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Neither a date, nor a repeat, nor a word of explanation. */
const droppedInSilence = (text: string) => {
  const r = parse(text);
  expect(r.title, text).toBe(text);
  expect(r.dueDate, text).toBeNull();
  expect(r.repeatAfter, text).toBeUndefined();
  expect(r.warnings, text).toEqual([]);
};

describe("F1 — a yearly repeat on a fixed date becomes a one-off, silently", () => {
  /*
   * The recurrence matcher has no shape for "ogni <day> <month>", so the date
   * layer takes "30 giugno" and the every-word is left stranded in the title.
   * The user asked for a yearly repeat and gets one task, a broken name, and no
   * message. Vikunja can express this: yearly is repeat_after = 365 days.
   */
  it("reads 'tasse ogni 30 giugno' as a single task called 'tasse ogni'", () => {
    const r = parse("tasse ogni 30 giugno");
    expect(r.title).toBe("tasse ogni");
    expect(ymd(r.dueDate as Date)).toBe("2027-06-30");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("does the same in English, so this is not an Italian gap", () => {
    const r = parse("pay tax every 30 june");
    expect(r.title).toBe("pay tax every");
    expect(ymd(r.dueDate as Date)).toBe("2027-06-30");
    expect(r.warnings).toEqual([]);
  });
});

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

describe("F5 — an Italian ordinal weekday becomes a one-off date, silently", () => {
  /*
   * ORDINAL_WORD in recurrence.ts is English-only, so "secondo" matches neither
   * the reject list nor the accept list. matchRecurrence returns null, nothing
   * is masked, and the date layer then reads "martedì" on its own.
   */
  it("schedules 'ogni secondo martedì' for next Tuesday, titled 'ogni secondo'", () => {
    const r = parse("ogni secondo martedì");
    expect(r.title).toBe("ogni secondo");
    expect(ymd(r.dueDate as Date)).toBe("2026-09-15");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("while the English equivalent is correctly refused and explained", () => {
    const r = parse("board every second tuesday");
    expect(r.title).toBe("board every second tuesday");
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });
});

describe("F6 — an Italian 'starting' phrase sets a repeat AND a date, silently", () => {
  /*
   * The worst of the six. `\bstarting\b` is English-only, so the reject pattern
   * misses; "ogni giorno" then matches the accept rule, and the date layer picks
   * "lunedì" out of the tail. The user gets a daily repeat they did ask for, a
   * one-off due date they did not, and a task named "a partire da".
   */
  it("keeps the repeat, invents a due date, and mangles the title", () => {
    const r = parse("ogni giorno a partire da lunedì");
    expect(r.title).toBe("a partire da");
    expect(r.repeatAfter).toBe(24 * 60 * 60);
    expect(ymd(r.dueDate as Date)).toBe("2026-09-14");
    expect(r.warnings).toEqual([]);
  });

  it("while the English equivalent is refused whole", () => {
    const r = parse("standup every day starting monday");
    expect(r.title).toBe("standup every day starting monday");
    expect(r.dueDate).toBeNull();
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });
});
