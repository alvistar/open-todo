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

/*
 * F8 to F10 come from an adversarial pass over the six fixes, not from the
 * corpus. Each is a case where a widened pattern now matches ORDINARY prose.
 * They are pinned rather than fixed because each one is a §5 decision with a
 * real trade-off, not a repair - and two of them are English behaviour that
 * predates this branch and that the Italian pack was given for parity.
 */

describe("F8 — a repeat adverb is read anywhere in the line, context or not", () => {
  /*
   * English has done this since before the language packs existed: "cancel the
   * service paid monthly" has always become a monthly task. F3 gave Italian the
   * adverbs it never had, and with them this flaw.
   *
   * Fixing it means requiring an every-word near the adverb, which would change
   * English too and would break the bare "daily" / "weekly" forms §5 lists. A
   * §5 decision, not a repair.
   */
  it("turns a cancellation into a monthly task", () => {
    const r = parse("disdire il servizio pagato mensilmente");
    expect(r.title).toBe("disdire il servizio pagato");
    expect(r.repeatAfter).toBe(30 * 24 * 60 * 60);
    expect(r.warnings).toEqual([]);
  });

  it("does the same in English, which is where the behaviour came from", () => {
    const r = parse("cancel the service paid monthly");
    expect(r.repeatAfter).toBe(30 * 24 * 60 * 60);
  });
});

describe("F9 — a 'starting' clause need not start a DATE", () => {
  /*
   * The reject rule is `every <word> … <starting-word> <tail>` with nothing
   * requiring the tail to be a date. English `starting` has always been
   * unconditional this way; F6 gave Italian the same rule and the same hole.
   *
   * The second case is the costly one: a daily repeat that used to work is now
   * refused. Narrowing the tail to date-shaped text is possible but has to
   * admit "next week", which carries no digit, weekday or month - so it is a
   * §5 grammar question, not a boundary tweak.
   */
  it("warns about a chapter list that is not a repeat", () => {
    const r = parse("ripassare ogni capitolo a partire dal secondo");
    expect(r.title).toBe("ripassare ogni capitolo a partire dal secondo");
    expect(r.warnings).toHaveLength(1);
  });

  it("loses a daily repeat that used to work", () => {
    const r = parse("leggere ogni giorno a partire dalla prima pagina");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });
});

describe("F10 — a month abbreviation is also an ordinary word", () => {
  /*
   * "set" is settembre; it is also the English noun and a count of exercise
   * sets. The WRONG DATE here predates this branch - the month + day row has
   * always read "3 set" as 3 September. F1 added the yearly repeat on top.
   *
   * The same tension as `mar` (Tuesday and the sea), which §5 already decided
   * by excluding 3-letter WEEKDAYS while keeping 3-letter MONTHS. Revisiting it
   * means reopening that decision.
   */
  it("schedules a set of push-ups for September", () => {
    const r = parse("fai 10 flessioni ogni 3 set");
    expect(r.title).toBe("fai 10 flessioni");
    expect(r.repeatAfter).toBe(365 * 24 * 60 * 60);
    expect(r.warnings).toEqual([]);
  });
});
