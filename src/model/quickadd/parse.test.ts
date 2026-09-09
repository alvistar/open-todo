import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "./parse";
import { DAY } from "./recurrence";

const TZ = "Europe/Rome";
const NOW = new Date("2026-09-09T08:00:00Z"); // Wed 9 Sep 2026, 10:00 Rome

const ctx = (over: Partial<QuickAddContext> = {}): QuickAddContext => ({
  now: NOW,
  timeZone: TZ,
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [
    { id: 1, title: "Inbox" },
    { id: 2, title: "Personal" },
    { id: 3, title: "Work" },
    { id: 4, title: "Casa e giardino" },
  ],
  labels: [
    { id: 10, title: "phone" },
    { id: 11, title: "urgent" },
  ],
  ...over,
});

const parse = (text: string, over: Partial<QuickAddContext> = {}) =>
  parseQuickAdd(text, ctx(over));

/** Asserts a due date was parsed, so the tests avoid non-null assertions. */
const due = (r: { dueDate: Date | null }): Date => {
  if (!r.dueDate) throw new Error("expected a due date");
  return r.dueDate;
};

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
const ymd = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

describe("parseQuickAdd — the whole phrase", () => {
  it("pulls every part out and leaves a clean title", () => {
    const r = parse("Call the accountant tomorrow at 10 #Work @phone p1");
    expect(r.title).toBe("Call the accountant");
    expect(r.projectId).toBe(3);
    expect(r.labelIds).toEqual([10]);
    expect(r.priority).toBe(4); // p1 -> 4 per D-map-1
    expect(ymd(due(r))).toBe("2026-09-10");
    expect(hhmm(due(r))).toBe("10:00");
    expect(r.allDay).toBe(false);
  });

  it("works the same in Italian", () => {
    const r = parse("Chiamare il commercialista domani alle 10 #Work p1");
    expect(r.title).toBe("Chiamare il commercialista");
    expect(ymd(due(r))).toBe("2026-09-10");
    expect(hhmm(due(r))).toBe("10:00");
  });

  it("leaves an empty title alone rather than inventing one", () => {
    expect(parse("tomorrow").title).toBe("");
  });
});

describe("parseQuickAdd — dates and the all-day convention", () => {
  it("uses the 20:00 fallback for a date with no time (D-map-2)", () => {
    const r = parse("Renew the domain tomorrow");
    expect(hhmm(due(r))).toBe("20:00");
    expect(r.allDay).toBe(true);
  });

  it("uses the server's default_due_time when there is one", () => {
    const r = parse("Renew the domain tomorrow", { defaultDueTime: "09:30" });
    expect(hhmm(due(r))).toBe("09:30");
    expect(r.allDay).toBe(true);
  });

  it("keeps an explicit time and does not mark it all-day", () => {
    const r = parse("Standup tomorrow 09:15");
    expect(hhmm(due(r))).toBe("09:15");
    expect(r.allDay).toBe(false);
  });

  it("ignores a time with no date", () => {
    const r = parse("Call at 10");
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("Call at 10");
  });
});

describe("parseQuickAdd — project", () => {
  it("matches a project by prefix, case-insensitively", () => {
    expect(parse("Ping #wor").projectId).toBe(3);
    expect(parse("Ping #PERSONAL").projectId).toBe(2);
  });

  it("accepts a quoted project name with spaces", () => {
    const r = parse('Ping #"Casa e giardino"');
    expect(r.projectId).toBe(4);
    expect(r.title).toBe("Ping");
  });

  it("leaves an unknown project as plain text, like Todoist does", () => {
    const r = parse("Ping #Nonexistent");
    expect(r.projectId).toBeNull();
    expect(r.title).toBe("Ping #Nonexistent");
  });

  it("falls back to the default project when none is given", () => {
    expect(parse("Ping").projectId).toBeNull();
    expect(parse("Ping").effectiveProjectId).toBe(1);
  });

  it("prefers an exact title over a shorter prefix match", () => {
    const r = parse("Ping #Work", {
      projects: [
        { id: 3, title: "Work" },
        { id: 9, title: "Workshop" },
      ],
    });
    expect(r.projectId).toBe(3);
  });
});

describe("parseQuickAdd — labels", () => {
  it("accepts @name and *name for existing labels", () => {
    expect(parse("Ping @phone").labelIds).toEqual([10]);
    expect(parse("Ping *urgent").labelIds).toEqual([11]);
  });

  it("collects several labels", () => {
    expect(parse("Ping @phone @urgent").labelIds).toEqual([10, 11]);
  });

  it("leaves an unknown label as plain text until it exists", () => {
    const r = parse("Ping @telefono");
    expect(r.labelIds).toEqual([]);
    expect(r.title).toBe("Ping @telefono");
  });
});

describe("parseQuickAdd — priority", () => {
  it("maps p1..p4 through D-map-1", () => {
    expect(parse("a p1").priority).toBe(4);
    expect(parse("a p2").priority).toBe(3);
    expect(parse("a p3").priority).toBe(2);
    expect(parse("a p4").priority).toBe(0);
  });

  it("takes !1..!5 literally, as Vikunja's own syntax", () => {
    // Forcing !5 through D-map-1 would write 4 and silently lose DO NOW.
    expect(parse("a !5").priority).toBe(5);
    expect(parse("a !1").priority).toBe(1);
  });

  it("ignores a p-token that is part of a word", () => {
    expect(parse("buy p1000 screws").priority).toBeNull();
  });
});

describe("parseQuickAdd — recurrence", () => {
  it("stores an accepted repeat and cleans the title", () => {
    const r = parse("Water the plants every day");
    expect(r.repeatAfter).toBe(DAY);
    expect(r.repeatMode).toBe(0);
    expect(r.title).toBe("Water the plants");
  });

  it("keeps an unsupported repeat in the title and warns", () => {
    const r = parse("Board every 2nd tuesday");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.title).toBe("Board every 2nd tuesday");
    expect(r.warnings.join(" ")).toMatch(/not supported/i);
    // And it must NOT be quietly re-read as a one-off date next Tuesday.
    expect(r.dueDate).toBeNull();
  });

  it("surfaces the weekday approximation as a warning", () => {
    const r = parse("Standup every weekday");
    expect(r.repeatAfter).toBeDefined();
    expect(r.warnings.join(" ")).toMatch(/weekly/i);
  });

  it("does not let a recurring weekday be eaten by the date matcher", () => {
    const r = parse("Gym every monday");
    expect(r.repeatAfter).toBeDefined();
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("Gym");
  });
});

describe("parseQuickAdd — highlight spans", () => {
  it("reports non-overlapping spans covering each recognised token", () => {
    const text = "Call tomorrow #Work p1";
    const r = parseQuickAdd(text, ctx());
    const kinds = r.spans.map((s) => s.kind).sort();
    expect(kinds).toEqual(["date", "priority", "project"]);
    for (const span of r.spans) {
      expect(text.slice(span.start, span.end).trim().length).toBeGreaterThan(0);
    }
    const sorted = [...r.spans].sort((a, b) => a.start - b.start);
    sorted.reduce((prevEnd, span) => {
      expect(span.start).toBeGreaterThanOrEqual(prevEnd);
      return span.end;
    }, 0);
  });
});
