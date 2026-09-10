import { describe, expect, it } from "vitest";
import { DAY, MONTH, matchRecurrence, WEEK, YEAR } from "./recurrence";

const r = (text: string) => matchRecurrence(text);

describe("matchRecurrence — accepted", () => {
  it("understands every day/week/month/year in both languages", () => {
    expect(r("water plants every day")).toMatchObject({ repeatAfter: DAY });
    expect(r("standup every week")).toMatchObject({ repeatAfter: WEEK });
    expect(r("rent every month")).toMatchObject({ repeatAfter: 30 * DAY });
    expect(r("mot every year")).toMatchObject({ repeatAfter: 365 * DAY });
    expect(r("piante ogni giorno")).toMatchObject({ repeatAfter: DAY });
    expect(r("affitto ogni mese")).toMatchObject({ repeatAfter: 30 * DAY });
  });

  it("understands the daily/weekly adverbs", () => {
    expect(r("standup daily")).toMatchObject({ repeatAfter: DAY });
    expect(r("report weekly")).toMatchObject({ repeatAfter: WEEK });
    expect(r("rent monthly")).toMatchObject({ repeatAfter: 30 * DAY });
    expect(r("mot yearly")).toMatchObject({ repeatAfter: 365 * DAY });
  });

  it("understands every N units", () => {
    expect(r("ping every 3 days")).toMatchObject({ repeatAfter: 3 * DAY });
    expect(r("ping every 2 weeks")).toMatchObject({ repeatAfter: 2 * WEEK });
    expect(r("ping ogni 3 giorni")).toMatchObject({ repeatAfter: 3 * DAY });
  });

  it("understands a single weekday as weekly", () => {
    expect(r("gym every monday")).toMatchObject({ repeatAfter: WEEK });
    expect(r("palestra ogni lunedì")).toMatchObject({ repeatAfter: WEEK });
  });

  it("treats every! as repeat-from-completion (repeat_mode 2)", () => {
    expect(r("clean every! 2 weeks")).toMatchObject({
      repeatAfter: 2 * WEEK,
      repeatMode: 2,
    });
  });

  it("defaults to repeat_mode 0", () => {
    expect(r("standup every week")?.repeatMode).toBe(0);
  });

  it("flags every weekday as an approximation rather than silently lying", () => {
    const match = r("standup every weekday");
    expect(match).toMatchObject({ repeatAfter: WEEK });
    expect(match?.warning).toMatch(/weekly/i);
  });

  it("reports the span it consumed", () => {
    const m = r("water plants every day");
    if (!m) throw new Error("expected a recurrence match");
    expect("water plants every day".slice(m.start, m.end)).toBe("every day");
  });
});

describe("matchRecurrence — rejected, never approximated", () => {
  it.each([
    "standup every mon, wed",
    "board every 2nd tuesday",
    "payroll every last day of month",
    "shift every workday at 9 starting monday",
  ])("rejects %s", (text) => {
    const match = r(text);
    expect(match?.rejected).toBe(true);
    expect(match?.repeatAfter).toBeUndefined();
  });

  it("returns null when there is no recurrence at all", () => {
    expect(r("just a plain task")).toBeNull();
  });
});

describe("matchRecurrence — regressions found in review", () => {
  it("accepts every N months in English", () => {
    // "mon" is an alternative in the weekday list and prefixes "month", so an
    // unanchored reject pattern swallowed the whole English months row and
    // told the user Vikunja could not do something it can.
    expect(r("ping every 2 months")).toMatchObject({ repeatAfter: 2 * MONTH });
    expect(r("ping every 6 months")).toMatchObject({ repeatAfter: 6 * MONTH });
    expect(r("ping every 1 month")).toMatchObject({ repeatAfter: MONTH });
    expect(r("ping every 2 years")).toMatchObject({ repeatAfter: 2 * YEAR });
  });

  it("rejects word-form ordinals, not just digits", () => {
    for (const text of [
      "board every second tuesday",
      "board every third monday",
      "board every other monday",
      "board every last friday",
    ]) {
      expect(matchRecurrence(text)?.rejected, text).toBe(true);
    }
  });

  it("rejects a `starting` phrase all the way to its end", () => {
    // The span must cover the trailing weekday, or the date matcher reads it.
    const m = matchRecurrence("shift every workday at 9 starting monday");
    expect(m?.rejected).toBe(true);
    expect("shift every workday at 9 starting monday".slice(m?.start, m?.end)).toContain(
      "monday",
    );
  });
});

describe("matchRecurrence — the shared vocabulary did not widen the grammar", () => {
  it("still takes the English weekday abbreviations", () => {
    expect(r("gym every sat")).toMatchObject({ repeatAfter: WEEK });
  });

  it("still refuses the Italian ones, which §5 never listed", () => {
    // Extracting the word lists into vocabulary.ts briefly added these, which
    // is a grammar amendment rather than a tidying-up: "ogni mar" scheduled a
    // weekly repeat where it had previously done nothing at all.
    for (const phrase of ["ogni mar", "ogni sab", "ogni gio", "ogni lun"]) {
      expect(r(phrase)).toBeNull();
    }
  });

  it("still takes the full Italian names", () => {
    expect(r("ogni marted\u00ec")).toMatchObject({ repeatAfter: WEEK });
  });
});
