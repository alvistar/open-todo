import { describe, expect, it } from "vitest";
import { matchWhen } from "./datePhrase";

const TZ = "Europe/Rome";
// Wednesday 9 September 2026, 10:00 in Rome.
const NOW = new Date("2026-09-09T08:00:00Z");

/** Local calendar day of the parsed instant, for readable assertions. */
const day = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const time = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

const whenOrNull = (text: string) => matchWhen(text, NOW, TZ).when;

/** The spans the §5 gate turned down, in text order. */
const rejected = (text: string) => matchWhen(text, NOW, TZ).rejected;

/** Asserts the gate turned something down, so the tests read without `?.`. */
const turnedDown = (text: string) => {
  const [first] = rejected(text);
  if (!first) throw new Error(`expected a rejected span in ${JSON.stringify(text)}`);
  return first;
};

/** Asserts a phrase matched, so the tests read without non-null assertions. */
const when = (text: string) => {
  const match = whenOrNull(text);
  if (!match) throw new Error(`expected a date phrase in ${JSON.stringify(text)}`);
  return match;
};

describe("matchWhen — relative days", () => {
  it("understands today and tomorrow in English and Italian", () => {
    expect(day(when("call mum today").date)).toBe("2026-09-09");
    expect(day(when("call mum tomorrow").date)).toBe("2026-09-10");
    expect(day(when("chiamare mamma oggi").date)).toBe("2026-09-09");
    expect(day(when("chiamare mamma domani").date)).toBe("2026-09-10");
  });

  it("understands tonight / stasera as today, with no time of its own", () => {
    // chrono resolves both to 22:00. The phrase names a day, not a clock time,
    // so it stays all-day and D-map-2 supplies the marker.
    expect(day(when("dinner tonight").date)).toBe("2026-09-09");
    expect(when("dinner tonight").hasTime).toBe(false);
    expect(day(when("cena stasera").date)).toBe("2026-09-09");
    expect(when("cena stasera").hasTime).toBe(false);
  });

  it("reports the span it consumed so the title can drop it", () => {
    const m = when("call mum tomorrow");
    expect("call mum tomorrow".slice(m.start, m.end)).toBe("tomorrow");
  });
});

describe("matchWhen — weekdays", () => {
  it("takes the next occurrence of a weekday, never today", () => {
    // NOW is a Wednesday. chrono resolves a bare weekday to today; a task is
    // about the day to come, so the same-day case is pushed a week out.
    expect(day(when("gym friday").date)).toBe("2026-09-11");
    expect(day(when("gym monday").date)).toBe("2026-09-14");
    expect(day(when("gym wednesday").date)).toBe("2026-09-16");
    expect(day(when("palestra mercoledì").date)).toBe("2026-09-16");
  });

  it("understands Italian weekdays", () => {
    expect(day(when("palestra venerdì").date)).toBe("2026-09-11");
    expect(day(when("palestra lunedi").date)).toBe("2026-09-14");
  });

  it("pushes a week out for next/prossimo, and only once", () => {
    expect(day(when("gym next friday").date)).toBe("2026-09-18");
    expect(day(when("palestra venerdì prossimo").date)).toBe("2026-09-18");
    // Already a week out, so the same-day rule must not push it again.
    expect(day(when("gym next wednesday").date)).toBe("2026-09-16");
  });
});

describe("matchWhen — offsets", () => {
  it("understands in N days/weeks/months", () => {
    expect(day(when("ping in 3 days").date)).toBe("2026-09-12");
    expect(day(when("ping in 2 weeks").date)).toBe("2026-09-23");
    expect(day(when("ping in 1 month").date)).toBe("2026-10-09");
  });

  it("understands tra N giorni/settimane/mesi", () => {
    expect(day(when("ping tra 3 giorni").date)).toBe("2026-09-12");
    expect(day(when("ping tra 2 settimane").date)).toBe("2026-09-23");
  });

  it("understands next week / next month and end of month", () => {
    expect(day(when("review next week").date)).toBe("2026-09-16");
    expect(day(when("review next month").date)).toBe("2026-10-09");
    // Neither chrono locale has these; they are matched before chrono runs.
    expect(day(when("invoice end of month").date)).toBe("2026-09-30");
    expect(day(when("fattura fine mese").date)).toBe("2026-09-30");
  });
});

describe("matchWhen — explicit dates", () => {
  it("parses an ISO date", () => {
    expect(day(when("deploy 2026-09-15").date)).toBe("2026-09-15");
  });

  it("parses day-month names in both languages", () => {
    expect(day(when("deploy 30 apr").date)).toBe("2027-04-30");
    expect(day(when("deploy 30 dic").date)).toBe("2026-12-30");
  });

  it("reads month-day as a date, not a year", () => {
    // chrono's en-GB parser returns 1 April 2030 for this: it reads the "30" as
    // a year. The Italian parser is right, and wins the tie on an equal span.
    expect(day(when("deploy Apr 30").date)).toBe("2027-04-30");
  });

  it("parses d/m only when unambiguous, and reads it day-first", () => {
    expect(day(when("deploy 15/9").date)).toBe("2026-09-15");
    // 13 cannot be a month, so it is unambiguous day-first.
    expect(day(when("deploy 13/10").date)).toBe("2026-10-13");
  });

  it("rolls a past bare date into next year", () => {
    // 1 Jan already passed in 2026.
    expect(day(when("party 1 jan").date)).toBe("2027-01-01");
  });

  it("returns null when there is no date at all", () => {
    expect(whenOrNull("just a plain task")).toBeNull();
  });

  it("does not treat a bare number as a date", () => {
    expect(whenOrNull("buy 4 apples")).toBeNull();
  });

  it("refuses impossible dates rather than rolling them over", () => {
    expect(whenOrNull("deploy 2026-13-45")).toBeNull();
    expect(whenOrNull("deploy 2026-02-30")).toBeNull();
    expect(whenOrNull("deploy 31/2")).toBeNull();
  });
});

describe("matchWhen — times", () => {
  it("parses a day with a time in both languages", () => {
    const en = when("standup tomorrow at 09:30");
    expect(en.hasTime).toBe(true);
    expect(day(en.date)).toBe("2026-09-10");
    expect(time(en.date)).toBe("09:30");

    const it_ = when("standup domani alle 10");
    expect(it_.hasTime).toBe(true);
    expect(time(it_.date)).toBe("10:00");
  });

  it("parses am/pm", () => {
    expect(time(when("call tomorrow 3pm").date)).toBe("15:00");
    expect(time(when("call tomorrow 12pm").date)).toBe("12:00");
  });

  it("keeps a bare clock face attached to its day", () => {
    const m = when("standup tomorrow 10:30");
    expect(m.hasTime).toBe(true);
    expect(time(m.date)).toBe("10:30");
  });

  it("is not a due date when the text carries only a time", () => {
    // "a time on its own is not a due date" - the text stays in the title.
    expect(whenOrNull("call at 10")).toBeNull();
    expect(whenOrNull("chiamare alle 10")).toBeNull();
    expect(whenOrNull("standup 10:30")).toBeNull();
  });

  it("a day with no time is left at midnight for the caller to fill in", () => {
    const m = when("standup tomorrow");
    expect(time(m.date)).toBe("00:00");
    expect(m.hasTime).toBe(false);
  });

  it("does not invent a date from a run of stray numbers", () => {
    // chrono reads "13 15/9" as 15 September at 13:00 - a day AND a clock time
    // the user never typed. The span is not a §5 shape, so nothing is taken:
    // before D-vocab this returned 15 September, all-day.
    expect(whenOrNull("x 45/13 15/9")).toBeNull();
  });
});

describe("matchWhen — the §5 gate reports what it turned down", () => {
  it("reports the rejected span and still finds the real date", () => {
    // The gate runs over every candidate before the sort, so the false
    // positive early in the line neither wins nor disappears.
    const r = matchWhen("I sat with the team tomorrow", NOW, TZ);
    expect(day(r.when?.date as Date)).toBe("2026-09-10");
    expect(r.rejected.map((s) => s.text)).toEqual(["sat"]);
  });

  it("reports one span when both locales reject the same phrase", () => {
    // Italian and English both match "weekend" at the same offset.
    expect(rejected("weekend plans")).toHaveLength(1);
  });

  it("reports one span when the two locales reject overlapping phrases", () => {
    // Italian matches [5,12) "weekend", English [0,14) "this weekend".
    expect(rejected("this weekend")).toHaveLength(1);
    expect(turnedDown("this weekend").text).toBe("this weekend");
  });

  it("says nothing when one locale accepts what the other rejects", () => {
    // "Apr 30" is 30 April to the Italian parser and a bare month+year to the
    // English one. A warning here would be about a phrase that set a date.
    const r = matchWhen("Apr 30", NOW, TZ);
    expect(day(r.when?.date as Date)).toBe("2027-04-30");
    expect(r.rejected).toEqual([]);
  });

  it("drops chrono's instant idioms without a word", () => {
    // "after a sec" is not redundant with "give me a sec": chrono's span for
    // it is the whole phrase rather than just "a sec".
    for (const phrase of [
      "buy now pay later",
      "give me a sec",
      "after a sec",
      "a second",
      "in a minute",
    ]) {
      expect(rejected(phrase)).toHaveLength(1);
      expect(turnedDown(phrase).silent).toBe(true);
    }
  });

  it("still speaks up for the phrases the idiom rule must not cover", () => {
    // Each of these is certain of an hour too, so only the weekday and the
    // digit tell them apart from "in a minute".
    for (const phrase of [
      "I sat at 10 with the team",
      "il mar alle 10 mosso",
      "call in 2 hours",
      "chiama tra 2 ore",
      "March report",
    ]) {
      expect(turnedDown(phrase).silent).toBe(false);
    }
  });

  it("says nothing about a bare time, which never becomes a candidate", () => {
    for (const phrase of ["call at 10", "alle 10", "10:30", "3pm"]) {
      expect(rejected(phrase)).toEqual([]);
    }
  });
});

describe("matchWhen — a leap day is found wherever it sits in the line", () => {
  it("resolves 29 February whatever surrounds it", () => {
    // chrono declines the phrase outright in 2026 and 2027, so this is the
    // retry's work. It used to require the phrase to end the line.
    for (const phrase of [
      "29 feb",
      "party 29 feb",
      "29 feb party",
      "party 29 feb please",
    ]) {
      expect(day(when(phrase).date)).toBe("2028-02-29");
    }
    expect(day(when("29 febbraio").date)).toBe("2028-02-29");
  });

  it("keeps the span on the user's words, not on the probed year", () => {
    expect(when("party 29 feb please").text).toBe("29 feb");
  });

  it("still refuses a day that exists in no year", () => {
    expect(whenOrNull("30 feb")).toBeNull();
    expect(whenOrNull("party 30 feb please")).toBeNull();
  });

  it("does not reach the retry for a digit without a month", () => {
    // The window filter is what keeps this off the per-keystroke path: chosen
    // on a digit alone, "buy 3 apples" would cost ~100 chrono parses a stroke.
    expect(whenOrNull("buy 3 apples")).toBeNull();
  });

  it("does not let the retry walk around the §5 gate", () => {
    // "sat" is a candidate chrono found and the gate refused, so the retry
    // must not run at all - appending a year to it would be a way through.
    expect(whenOrNull("I sat down with the team")).toBeNull();
  });
});

/*
 * One test per row of the §5.1 table, named after the row. Drift between the
 * table and the acceptor is then a reading exercise rather than a debugging
 * one - which matters, because re-stating §5's vocabulary in code is the whole
 * cost of D-vocab.
 */
describe("matchWhen — §5.1 rows that must resolve", () => {
  it("relative day", () => {
    expect(day(when("dopodomani").date)).toBe("2026-09-11");
  });

  it("day part suffix", () => {
    expect(day(when("tomorrow morning").date)).toBe("2026-09-10");
    expect(day(when("domani sera").date)).toBe("2026-09-10");
    expect(day(when("sabato mattina").date)).toBe("2026-09-12");
    expect(day(when("friday afternoon").date)).toBe("2026-09-11");
  });

  it("weekday, full name — adjective either side in Italian", () => {
    expect(day(when("venerdì prossimo").date)).toBe("2026-09-18");
    expect(day(when("prossimo venerdì").date)).toBe("2026-09-18");
  });

  it("numeric offset — fra is tra, and the count may be a word", () => {
    expect(day(when("fra 3 giorni").date)).toBe("2026-09-12");
    expect(day(when("tra una settimana").date)).toBe("2026-09-16");
    expect(day(when("tra un mese").date)).toBe("2026-10-09");
  });

  it("next period — both Italian word orders", () => {
    expect(day(when("la settimana prossima").date)).toBe("2026-09-16");
    expect(day(when("prossima settimana").date)).toBe("2026-09-16");
    expect(day(when("il mese prossimo").date)).toBe("2026-10-09");
  });

  it("month + day — full month names, both orders", () => {
    expect(day(when("15 settembre").date)).toBe("2026-09-15");
    expect(day(when("settembre 15").date)).toBe("2026-09-15");
  });

  it("month + day + year", () => {
    expect(day(when("15 sep 2027").date)).toBe("2027-09-15");
    expect(day(when("15 set 2027").date)).toBe("2027-09-15");
  });
});

describe("matchWhen — §5.1 rows that are deliberately excluded", () => {
  it("3-letter weekdays, English and Italian", () => {
    for (const phrase of ["sat", "mon", "wed", "lun", "ven", "gio", "sab", "dom"]) {
      expect(whenOrNull(phrase)).toBeNull();
    }
    // The two that made the case: both are ordinary words as well as days.
    expect(whenOrNull("I sat down with the team")).toBeNull();
    expect(whenOrNull("il mar mosso")).toBeNull();
    expect(whenOrNull("call next mon")).toBeNull();
  });

  it("this <weekday> and the weekend", () => {
    // "this Wednesday" resolved a week out - the wrong date, not merely an
    // undocumented one.
    expect(whenOrNull("this Wednesday")).toBeNull();
    expect(whenOrNull("weekend plans")).toBeNull();
    expect(whenOrNull("this weekend")).toBeNull();
    expect(whenOrNull("fine settimana")).toBeNull();
  });

  it("dates in the past", () => {
    for (const phrase of ["yesterday", "ieri", "last friday"]) {
      expect(whenOrNull(phrase)).toBeNull();
    }
  });

  it("a month name with a number chrono reads as a year", () => {
    // "feb 29" resolved to 1 February 2029 and "Sep 15" to 1 September 2015,
    // both with the day merely implied.
    expect(whenOrNull("feb 29")).toBeNull();
    expect(whenOrNull("Sep 15")).toBeNull();
  });

  it("a bare month name", () => {
    expect(whenOrNull("March report")).toBeNull();
    expect(whenOrNull("marzo report")).toBeNull();
  });

  it("a range, which chrono collapses to its start", () => {
    expect(whenOrNull("Friday to Monday")).toBeNull();
  });

  it("offsets in hours, which the two locales did not even agree on", () => {
    // One returned all-day, the other 12:00, purely because "ore" is a time
    // marker and "hours" is not.
    expect(whenOrNull("call in 2 hours")).toBeNull();
    expect(whenOrNull("chiama tra 2 ore")).toBeNull();
  });

  it("next year", () => {
    expect(whenOrNull("next year")).toBeNull();
  });
});
