import { describe, expect, it } from "vitest";
import { matchDatePhrase, matchTimePhrase } from "./datePhrase";

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

const dateOrNull = (text: string) => matchDatePhrase(text, NOW, TZ);

/** Asserts a phrase matched, so the tests read without non-null assertions. */
const date = (text: string) => {
  const match = dateOrNull(text);
  if (!match) throw new Error(`expected a date phrase in ${JSON.stringify(text)}`);
  return match;
};
const timeOf = (text: string) => {
  const match = matchTimePhrase(text);
  if (!match) throw new Error(`expected a time phrase in ${JSON.stringify(text)}`);
  return match;
};

describe("matchDatePhrase — relative days", () => {
  it("understands today and tomorrow in English and Italian", () => {
    expect(day(date("call mum today").date)).toBe("2026-09-09");
    expect(day(date("call mum tomorrow").date)).toBe("2026-09-10");
    expect(day(date("chiamare mamma oggi").date)).toBe("2026-09-09");
    expect(day(date("chiamare mamma domani").date)).toBe("2026-09-10");
  });

  it("understands tonight / stasera as today", () => {
    expect(day(date("dinner tonight").date)).toBe("2026-09-09");
    expect(day(date("cena stasera").date)).toBe("2026-09-09");
  });

  it("reports the span it consumed so the title can drop it", () => {
    const m = date("call mum tomorrow");
    expect("call mum tomorrow".slice(m.start, m.end)).toBe("tomorrow");
  });
});

describe("matchDatePhrase — weekdays", () => {
  it("takes the next occurrence of a weekday, never today", () => {
    // NOW is a Wednesday.
    expect(day(date("gym friday").date)).toBe("2026-09-11");
    expect(day(date("gym monday").date)).toBe("2026-09-14");
    expect(day(date("gym wednesday").date)).toBe("2026-09-16");
  });

  it("understands Italian weekdays", () => {
    expect(day(date("palestra venerdì").date)).toBe("2026-09-11");
    expect(day(date("palestra lunedi").date)).toBe("2026-09-14");
  });

  it("pushes a week out for next/prossimo", () => {
    expect(day(date("gym next friday").date)).toBe("2026-09-18");
    expect(day(date("palestra venerdì prossimo").date)).toBe("2026-09-18");
  });
});

describe("matchDatePhrase — offsets", () => {
  it("understands in N days/weeks/months", () => {
    expect(day(date("ping in 3 days").date)).toBe("2026-09-12");
    expect(day(date("ping in 2 weeks").date)).toBe("2026-09-23");
    expect(day(date("ping in 1 month").date)).toBe("2026-10-09");
  });

  it("understands tra N giorni/settimane/mesi", () => {
    expect(day(date("ping tra 3 giorni").date)).toBe("2026-09-12");
    expect(day(date("ping tra 2 settimane").date)).toBe("2026-09-23");
  });

  it("understands next week / next month and end of month", () => {
    expect(day(date("review next week").date)).toBe("2026-09-16");
    expect(day(date("review next month").date)).toBe("2026-10-09");
    expect(day(date("invoice end of month").date)).toBe("2026-09-30");
    expect(day(date("fattura fine mese").date)).toBe("2026-09-30");
  });
});

describe("matchDatePhrase — explicit dates", () => {
  it("parses an ISO date", () => {
    expect(day(date("deploy 2026-09-15").date)).toBe("2026-09-15");
  });

  it("parses day-month names in both languages", () => {
    expect(day(date("deploy 30 apr").date)).toBe("2027-04-30");
    expect(day(date("deploy Apr 30").date)).toBe("2027-04-30");
    expect(day(date("deploy 30 dic").date)).toBe("2026-12-30");
  });

  it("parses d/m only when unambiguous, and reads it day-first", () => {
    expect(day(date("deploy 15/9").date)).toBe("2026-09-15");
    // 13 cannot be a month, so it is unambiguous day-first.
    expect(day(date("deploy 13/10").date)).toBe("2026-10-13");
  });

  it("rolls a past bare date into next year", () => {
    // 1 Jan already passed in 2026.
    expect(day(date("party 1 jan").date)).toBe("2027-01-01");
  });

  it("returns null when there is no date at all", () => {
    expect(dateOrNull("just a plain task")).toBeNull();
  });

  it("does not treat a bare number as a date", () => {
    expect(dateOrNull("buy 4 apples")).toBeNull();
  });
});

describe("matchTimePhrase", () => {
  const t = (text: string) => matchTimePhrase(text);

  it("parses at H / alle H", () => {
    expect(t("call at 10")).toMatchObject({ hours: 10, minutes: 0 });
    expect(t("chiamare alle 10")).toMatchObject({ hours: 10, minutes: 0 });
  });

  it("parses H:MM", () => {
    expect(t("standup 10:30")).toMatchObject({ hours: 10, minutes: 30 });
  });

  it("parses am/pm", () => {
    expect(t("call 3pm")).toMatchObject({ hours: 15, minutes: 0 });
    expect(t("call 12am")).toMatchObject({ hours: 0, minutes: 0 });
    expect(t("call 12pm")).toMatchObject({ hours: 12, minutes: 0 });
  });

  it("ignores impossible times", () => {
    expect(t("code 99:99")).toBeNull();
  });

  it("does not read a bare number as a time", () => {
    expect(t("buy 4 apples")).toBeNull();
  });
});

describe("date and time combine", () => {
  it("applies a parsed time to a parsed day", () => {
    const d = date("standup tomorrow at 09:30");
    const tm = timeOf("standup tomorrow at 09:30");
    const combined = tm.apply(d.date, TZ);
    expect(day(combined)).toBe("2026-09-10");
    expect(time(combined)).toBe("09:30");
  });

  it("a day with no time is left at midnight for the caller to fill in", () => {
    const d = date("standup tomorrow");
    expect(time(d.date)).toBe("00:00");
    expect(d.hasTime).toBe(false);
  });
});
