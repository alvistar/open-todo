import { describe, expect, it } from "vitest";
import {
  classifySchedule,
  DEFAULT_ALL_DAY_TIME,
  dayKey,
  formatDueLabel,
  isAllDay,
  parseVikunjaDate,
} from "./dates";

const TZ = "Europe/Rome";
// 2026-09-09T10:00 in Rome (CEST, UTC+2).
const NOW = new Date("2026-09-09T08:00:00Z");

describe("parseVikunjaDate", () => {
  it("parses a real timestamp", () => {
    expect(parseVikunjaDate("2026-09-09T18:00:00Z")?.toISOString()).toBe(
      "2026-09-09T18:00:00.000Z",
    );
  });

  it("treats Vikunja's zero date as unset", () => {
    expect(parseVikunjaDate("0001-01-01T00:00:00Z")).toBeNull();
  });

  it("treats null, empty and unparseable input as unset", () => {
    expect(parseVikunjaDate(null)).toBeNull();
    expect(parseVikunjaDate(undefined)).toBeNull();
    expect(parseVikunjaDate("")).toBeNull();
    expect(parseVikunjaDate("not a date")).toBeNull();
  });
});

describe("dayKey", () => {
  it("uses the given timezone, not the runtime's", () => {
    // 22:30 UTC is already the next day in Rome.
    expect(dayKey(new Date("2026-09-09T22:30:00Z"), TZ)).toBe("2026-09-10");
    expect(dayKey(new Date("2026-09-09T22:30:00Z"), "UTC")).toBe("2026-09-09");
  });
});

describe("classifySchedule", () => {
  const kind = (iso: string) => classifySchedule(new Date(iso), NOW, TZ);

  it("calls anything before today overdue", () => {
    // 22:00 Rome on the 8th, i.e. 20:00Z.
    expect(kind("2026-09-08T20:00:00Z")).toBe("overdue");
    expect(kind("2026-08-01T10:00:00Z")).toBe("overdue");
  });

  it("classifies by the user's calendar day, not UTC's", () => {
    // 22:00Z on the 8th is already 00:00 on the 9th in Rome: today, not overdue.
    expect(kind("2026-09-08T22:00:00Z")).toBe("today");
    expect(classifySchedule(new Date("2026-09-08T22:00:00Z"), NOW, "UTC")).toBe(
      "overdue",
    );
  });

  it("calls the rest of today today, even at a past hour", () => {
    // 06:00 Rome is earlier than "now" but still today.
    expect(kind("2026-09-09T04:00:00Z")).toBe("today");
    expect(kind("2026-09-09T20:00:00Z")).toBe("today");
  });

  it("classifies tomorrow and the coming week", () => {
    expect(kind("2026-09-10T09:00:00Z")).toBe("tomorrow");
    expect(kind("2026-09-13T09:00:00Z")).toBe("next-week");
    expect(kind("2026-09-16T09:00:00Z")).toBe("next-week");
  });

  it("classifies anything beyond a week as later", () => {
    expect(kind("2026-09-17T09:00:00Z")).toBe("later");
    expect(kind("2027-01-01T09:00:00Z")).toBe("later");
  });
});

describe("D-map-2 all-day detection", () => {
  it("uses the 20:00 fallback when the server has no default_due_time", () => {
    expect(DEFAULT_ALL_DAY_TIME).toBe("20:00");
    // 20:00 Rome == 18:00Z in September.
    expect(isAllDay(new Date("2026-09-09T18:00:00Z"), null, TZ)).toBe(true);
    expect(isAllDay(new Date("2026-09-09T08:00:00Z"), null, TZ)).toBe(false);
  });

  it("honours the user's default_due_time when the server provides one", () => {
    // 09:00 Rome == 07:00Z.
    expect(isAllDay(new Date("2026-09-09T07:00:00Z"), "09:00", TZ)).toBe(true);
    expect(isAllDay(new Date("2026-09-09T18:00:00Z"), "09:00", TZ)).toBe(false);
  });

  it("compares in the user's timezone, not the runtime's", () => {
    // 20:00 UTC is not 20:00 in Rome.
    expect(isAllDay(new Date("2026-09-09T20:00:00Z"), null, TZ)).toBe(false);
    expect(isAllDay(new Date("2026-09-09T20:00:00Z"), null, "UTC")).toBe(true);
  });

  it("falls back when default_due_time is malformed", () => {
    expect(isAllDay(new Date("2026-09-09T18:00:00Z"), "nonsense", TZ)).toBe(true);
  });
});

describe("formatDueLabel", () => {
  const label = (iso: string, allDayTime: string | null = null) =>
    formatDueLabel(new Date(iso), NOW, TZ, allDayTime, "en-GB");

  it("names today, tomorrow and yesterday", () => {
    expect(label("2026-09-09T18:00:00Z")).toBe("Today");
    expect(label("2026-09-10T18:00:00Z")).toBe("Tomorrow");
    expect(label("2026-09-08T18:00:00Z")).toBe("Yesterday");
  });

  it("appends the time when it is not the all-day default", () => {
    expect(label("2026-09-09T08:00:00Z")).toBe("Today 10:00");
    expect(label("2026-09-10T08:00:00Z")).toBe("Tomorrow 10:00");
  });

  it("omits the time when it equals the all-day default (D-map-2)", () => {
    expect(label("2026-09-09T07:00:00Z", "09:00")).toBe("Today");
  });

  it("uses the weekday inside the coming week", () => {
    expect(label("2026-09-13T18:00:00Z")).toBe("Sunday");
  });

  it("uses a date beyond that, adding the year only when it differs", () => {
    expect(label("2026-10-20T18:00:00Z")).toBe("20 Oct");
    // January is CET (UTC+1), so the 20:00 all-day marker is 19:00Z, not 18:00Z.
    expect(label("2027-01-20T19:00:00Z")).toBe("20 Jan 2027");
  });

  it("keeps the all-day marker tied to wall-clock time across DST", () => {
    // Same wall-clock 20:00 in Rome, different UTC instants either side of the
    // October changeover; both must read as all-day.
    expect(isAllDay(new Date("2026-10-20T18:00:00Z"), null, TZ)).toBe(true);
    expect(isAllDay(new Date("2026-11-20T19:00:00Z"), null, TZ)).toBe(true);
  });
});
