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

  it("understands a fixed calendar date as yearly, in both orders", () => {
    expect(r("tasse ogni 30 giugno")).toMatchObject({ repeatAfter: YEAR });
    expect(r("pay tax every 30 june")).toMatchObject({ repeatAfter: YEAR });
    expect(r("ogni giugno 30")).toMatchObject({ repeatAfter: YEAR });
    expect(r("ping every 1 jan")).toMatchObject({ repeatAfter: YEAR });
    expect(r("ping ogni 5 mag")).toMatchObject({ repeatAfter: YEAR });
  });

  it("consumes the every-word only, leaving the date for the date layer", () => {
    // The one accepted rule that does not swallow its whole phrase: a yearly
    // repeat needs the day of the year the user actually typed.
    const text = "tasse ogni 30 giugno";
    const m = r(text);
    if (!m) throw new Error("expected a recurrence match");
    expect(text.slice(m.start, m.end)).toBe("ogni");
  });

  it("leaves a fixed date that names its own year alone", () => {
    // A repeat starting in one named year is a contradiction, not a repeat.
    expect(r("pay tax every 30 june 2028")).toBeNull();
    expect(r("tasse ogni 30 giugno 2028")).toBeNull();
  });

  it("does not accept a date the date layer will refuse", () => {
    // "april 3rd" is an ordinal; §5.1's month + day row admits a bare number
    // only. Accepting the repeat here would leave a yearly task with no date to
    // repeat from, and the warning about "april 3rd" still on the screen.
    expect(r("every april 3rd")).toBeNull();
    expect(r("every 3rd april")).toBeNull();
  });

  it("does not read a unit as a month", () => {
    // "mar", "mag" and "set" are month abbreviations. "months" is not one, and
    // `every 2 months` must stay a two-month repeat.
    expect(r("ping every 2 months")).toMatchObject({ repeatAfter: 2 * MONTH });
    expect(r("ping ogni 3 giorni")).toMatchObject({ repeatAfter: 3 * DAY });
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
    // Formerly F5: the ordinal words were English-only, so each of these fell
    // through to the date layer and became a one-off on the named weekday.
    "board ogni secondo martedì",
    "board ogni seconda domenica",
    "board ogni 2° martedì",
    "board ogni ultimo venerdì del mese",
    "board ogni altro lunedì",
  ])("rejects %s", (text) => {
    const match = r(text);
    expect(match?.rejected).toBe(true);
    expect(match?.repeatAfter).toBeUndefined();
  });

  it("keeps the Italian rejection span whole, tail included", () => {
    // The tail must be inside the span, or "del mese" survives for the date
    // layer to read - which is the silent re-interpretation rejecting prevents.
    const text = "board ogni secondo martedì del mese";
    const m = r(text);
    if (!m) throw new Error("expected a rejection");
    expect(text.slice(m.start, m.end)).toBe("ogni secondo martedì del mese");
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
