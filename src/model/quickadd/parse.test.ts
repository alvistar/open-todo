import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "./parse";
import { DAY, YEAR } from "./recurrence";

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

describe("parseQuickAdd — workday and weekday are the same idea", () => {
  /*
   * Formerly known defect F3. "standup every workday" set nothing and said
   * nothing, while "standup every weekday" became a weekly repeat with the
   * approximation spelled out. Two words for one idea and only one in the
   * grammar - a vocabulary gap, not a decision.
   */
  it.each([
    "standup every weekday",
    "standup every workday",
    "standup every working day",
    "standup ogni giorno feriale",
    "standup ogni giorni lavorativi",
  ])("approximates %s to weekly, out loud", (text) => {
    const r = parse(text);
    expect(r.repeatAfter).toBe(7 * DAY);
    expect(r.title).toBe("standup");
    expect(r.warnings.join(" ")).toMatch(/weekly/i);
  });

  it("gives Italian the adverbs English always had", () => {
    // "report mensilmente" set nothing where "report monthly" set a repeat.
    expect(parse("report mensilmente").repeatAfter).toBe(30 * DAY);
    expect(parse("piante quotidianamente").repeatAfter).toBe(DAY);
    expect(parse("report settimanalmente").repeatAfter).toBe(7 * DAY);
    expect(parse("revisione annualmente").repeatAfter).toBe(365 * DAY);
  });
});

describe("parseQuickAdd — a list of day numbers is refused, like a list of weekdays", () => {
  /*
   * Formerly known defect F4. The reject rule needed a weekday on BOTH sides of
   * the separator, so "5,6" matched nothing at all: no date, no repeat, and no
   * word of explanation, while "every mon, wed" was refused and explained. Not
   * an Italian asymmetry - both languages were silent on digits.
   *
   * Nothing was ever LOST here, unlike F1, F5 and F6. The whole fix is that the
   * composer now says why nothing happened.
   */
  it.each(["ogni 5,6 alle 15", "every 5,6 at 3pm"])("explains %s", (text) => {
    const r = parse(text);
    expect(r.title).toBe(text);
    expect(r.dueDate).toBeNull();
    expect(r.repeatAfter).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });

  it("still refuses a weekday list, as it always did", () => {
    expect(parse("standup every mon, wed").warnings).toHaveLength(1);
  });

  it("does not refuse an ordinary counted repeat", () => {
    expect(parse("ping every 2 weeks").warnings).toEqual([]);
    expect(parse("ping ogni 3 giorni").warnings).toEqual([]);
  });
});

describe("parseQuickAdd — a 'starting' clause is refused in both languages", () => {
  /*
   * Formerly known defect F6, and the worst of the six. `\bstarting\b` was
   * English-only, so the reject rule missed; "ogni giorno" then matched the
   * ACCEPT rule, and the date layer picked "lunedì" out of the tail. The user
   * got a daily repeat they did ask for, a one-off due date they did not, and a
   * task named "a partire da".
   */
  it("refuses the whole Italian phrase, repeat and date together", () => {
    const r = parse("ogni giorno a partire da lunedì");
    expect(r.title).toBe("ogni giorno a partire da lunedì");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });

  it("does the same for the English form, as it always did", () => {
    const r = parse("standup every day starting monday");
    expect(r.title).toBe("standup every day starting monday");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });

  it("does not refuse an ordinary daily task that contains 'da'", () => {
    // The reason the bare "da" is NOT a starting-word: it is the commonest
    // preposition in the language, and this is a plain daily repeat.
    const r = parse("ogni giorno da fare");
    expect(r.repeatAfter).toBe(DAY);
    expect(r.title).toBe("da fare");
    expect(r.warnings).toEqual([]);
  });
});

describe("parseQuickAdd — an ordinal weekday is refused in both languages", () => {
  /*
   * Formerly known defect F5. "ogni secondo martedì" used to be scheduled for
   * next Tuesday under the title "ogni secondo", in silence, because the ordinal
   * WORDS were English-only: the phrase matched neither the reject list nor the
   * accept list, nothing was masked, and the date layer then read "martedì" on
   * its own. The English half was already correct, which is what made it a gap
   * rather than a decision.
   */
  it("refuses the Italian form and explains, as it always did the English", () => {
    const it_ = parse("board ogni secondo martedì");
    expect(it_.title).toBe("board ogni secondo martedì");
    expect(it_.dueDate).toBeNull();
    expect(it_.repeatAfter).toBeUndefined();
    expect(it_.warnings).toHaveLength(1);

    const en = parse("board every second tuesday");
    expect(en.title).toBe("board every second tuesday");
    expect(en.dueDate).toBeNull();
    expect(en.warnings).toHaveLength(1);
  });

  it("does not let the weekday escape into a one-off date", () => {
    expect(parse("board ogni ultimo venerdì del mese").dueDate).toBeNull();
  });

  it("leaves a bare ordinal alone when no weekday follows", () => {
    // "ogni secondo" is "every second", not an ordinal phrase. The rule needs a
    // weekday after the ordinal, and this must stay a plain unparsed title.
    const r = parse("conta ogni secondo");
    expect(r.title).toBe("conta ogni secondo");
    expect(r.repeatAfter).toBeUndefined();
    expect(r.dueDate).toBeNull();
  });
});

describe("parseQuickAdd — a yearly repeat on a fixed date keeps its anchor", () => {
  /*
   * Formerly known defect F1. "tasse ogni 30 giugno" used to produce a task
   * called "tasse ogni", due once in 2027, with no repeat and no warning: the
   * date layer took "30 giugno" and the every-word was stranded in the title.
   *
   * The rule deliberately consumes the every-word ONLY, unlike every other
   * accepted repeat, so the date beside it still reaches the date layer. A
   * yearly repeat with no date to repeat from would be no more useful than the
   * one-off it replaced.
   */
  it("reads the repeat AND the date out of the Italian form", () => {
    const r = parse("tasse ogni 30 giugno");
    expect(r.title).toBe("tasse");
    expect(r.repeatAfter).toBe(YEAR);
    expect(r.repeatMode).toBe(0);
    expect(ymd(due(r))).toBe("2027-06-30");
    // Vikunja's year is 365 days, exactly as "every year" already stores it,
    // so this is not an approximation worth a warning of its own.
    expect(r.warnings).toEqual([]);
  });

  it("does the same in English", () => {
    const r = parse("pay tax every 30 june");
    expect(r.title).toBe("pay tax");
    expect(r.repeatAfter).toBe(YEAR);
    expect(ymd(due(r))).toBe("2027-06-30");
    expect(r.warnings).toEqual([]);
  });

  it("carries a time clause through", () => {
    const r = parse("standup ogni 30 giugno alle 9");
    expect(r.title).toBe("standup");
    expect(r.repeatAfter).toBe(YEAR);
    expect(hhmm(due(r))).toBe("09:00");
    expect(r.allDay).toBe(false);
  });

  it("honours every! as repeat-from-completion", () => {
    expect(parse("pay tax every! 30 june").repeatMode).toBe(2);
  });

  it("leaves a date that names its own year alone", () => {
    // "every 30 june 2028" names one specific year, which contradicts a repeat.
    // It keeps the one-off reading rather than becoming a yearly task.
    const r = parse("pay tax every 30 june 2028");
    expect(r.repeatAfter).toBeUndefined();
    expect(ymd(due(r))).toBe("2028-06-30");
  });

  it("does not turn a counted repeat into a date", () => {
    // "mar", "set" and "mag" are month abbreviations; "months" must not be one.
    expect(parse("ping every 2 months").repeatAfter).toBe(60 * DAY);
    expect(parse("ping ogni 3 giorni").repeatAfter).toBe(3 * DAY);
  });

  it("highlights the every-word and the date as separate spans", () => {
    const input = "tasse ogni 30 giugno";
    const r = parse(input);
    expect(r.spans.map((s) => [s.kind, s.text])).toEqual([
      ["recurrence", "ogni"],
      ["date", "30 giugno"],
    ]);
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

describe("parseQuickAdd — R2: an unsupported repeat never becomes a date", () => {
  it.each([
    "shift every workday at 9 starting monday",
    "board every second tuesday",
    "board every third monday of the month",
    "board every other monday",
  ])("keeps %s intact with no invented due date", (text) => {
    const r = parse(text);
    expect(r.dueDate).toBeNull();
    expect(r.repeatAfter).toBeUndefined();
    expect(r.title).toBe(text);
    expect(r.warnings.join(" ")).toMatch(/not supported/i);
  });
});

describe("parseQuickAdd — R1: a sigil is never eaten from the inside", () => {
  it("treats @monday as a label token, not a date", () => {
    const r = parse("ping @monday");
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("ping @monday"); // unknown label stays verbatim
  });

  it("resolves a project whose name is a date word", () => {
    const r = parse("ping #Lunedi", {
      projects: [{ id: 7, title: "Lunedi" }],
    });
    expect(r.projectId).toBe(7);
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("ping");
  });

  it("does not swallow a label out of an email address", () => {
    const r = parse("send report to bob@work.com tomorrow", {
      labels: [{ id: 12, title: "work" }],
    });
    expect(r.title).toBe("send report to bob@work.com");
    expect(r.labelIds).toEqual([]);
  });
});

describe("parseQuickAdd — invalid dates are refused, not rolled over", () => {
  it.each(["deadline 2026-13-45", "x 2026-02-30", "party 31/2", "x 31 feb"])(
    "leaves %s alone",
    (text) => {
      const r = parse(text);
      expect(r.dueDate).toBeNull();
      expect(r.title).toBe(text);
    },
  );

  it("rolls 29 feb to the next leap year rather than to 1 March", () => {
    const r = parse("party 29 feb");
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(due(r));
    expect(iso).toBe("2028-02-29");
  });
});

describe("parseQuickAdd — the title reads cleanly", () => {
  it("absorbs the preposition along with the time", () => {
    expect(parse("call mom tomorrow at 10:30").title).toBe("call mom");
    expect(parse("call tomorrow at 3pm").title).toBe("call");
    expect(parse("cena domani alle 20:30").title).toBe("cena");
  });
});

describe("parseQuickAdd — a sigil between the date and the time", () => {
  /*
   * chrono reads "domani <blanked> alle 10" as one phrase, so its span covers
   * the "#Work" that was already consumed as a project. Overlapping spans cut
   * the title twice and corrupt it, so the date span is split around whatever
   * has already been taken.
   */
  it("keeps the date and the time together across a consumed project", () => {
    const r = parse("call mum domani #Work alle 10");
    expect(r.title).toBe("call mum");
    expect(r.projectId).toBe(3);
    expect(ymd(due(r))).toBe("2026-09-10");
    expect(hhmm(due(r))).toBe("10:00");
  });

  it("leaves the spans disjoint and inside the input", () => {
    const input = "call mum domani #Work alle 10";
    const r = parse(input);
    const sorted = [...r.spans].sort((a, b) => a.start - b.start);
    for (const [i, span] of sorted.entries()) {
      expect(span.text).toBe(input.slice(span.start, span.end));
      expect(span.start).toBeLessThan(span.end);
      const previous = sorted[i - 1];
      if (previous) expect(span.start).toBeGreaterThanOrEqual(previous.end);
    }
    // Every highlighted fragment is real text, never the blanked gap.
    expect(sorted.map((s) => s.text)).toEqual(["domani", "#Work", "alle 10"]);
  });
});

describe("parseQuickAdd — # does not match mid-word", () => {
  it("ignores a # attached to the preceding word", () => {
    // "#" was the only sigil without the lookbehind that @label and p1 use, so
    // it was the only one that could fire from inside another token.
    const r = parse("close issue#3 and ping");
    expect(r.projectId).toBeNull();
    expect(r.title).toBe("close issue#3 and ping");
  });

  it("still matches at the start of the text and after a space", () => {
    expect(parse("#Work ping").projectId).toBe(3);
    expect(parse("ping #Work").projectId).toBe(3);
    expect(parse('ping #"Casa e giardino"').projectId).toBe(4);
  });

  it("ignores a quoted project attached to the preceding word", () => {
    const r = parse('close issue#"Casa e giardino" please');
    expect(r.projectId).toBeNull();
    expect(r.title).toBe('close issue#"Casa e giardino" please');
  });
});

describe("parseQuickAdd — a date outside §5 is reported, not swallowed", () => {
  it("keeps the whole title, sets no date, and says why", () => {
    const r = parse("I sat down with the team");
    expect(r.title).toBe("I sat down with the team");
    expect(r.dueDate).toBeNull();
    expect(r.spans).toEqual([]);
    expect(r.warnings).toEqual([
      '"sat" is not a date open-todo recognises and was kept in the task name.',
    ]);
  });

  it("warns and still sets the date the user did type", () => {
    const r = parse("I sat with the team domani");
    expect(r.title).toBe("I sat with the team");
    expect(ymd(due(r))).toBe("2026-09-10");
    expect(r.warnings).toHaveLength(1);
  });

  it("says nothing about chrono's instant idioms", () => {
    const r = parse("buy now pay later");
    expect(r.title).toBe("buy now pay later");
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("warns once per phrase, never once per locale", () => {
    // QuickAdd keys the warning list on the message itself, so a duplicate
    // would collide in React as well as read badly.
    expect(parse("weekend plans").warnings).toHaveLength(1);
  });

  it("leaves the sigils alone while it does it", () => {
    const r = parse("il mar mosso #Work p1");
    expect(r.title).toBe("il mar mosso");
    expect(r.projectId).toBe(3);
    expect(r.priority).toBe(4);
    expect(r.dueDate).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });
});

describe("parseQuickAdd — quoting the whole line turns the grammar off", () => {
  it("takes a quoted line literally", () => {
    const r = parse('"Buy milk tomorrow"');
    expect(r.title).toBe("Buy milk tomorrow");
    expect(r.dueDate).toBeNull();
    expect(r.spans).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("accepts single quotes and ignores whitespace around them", () => {
    expect(parse("'Buy milk tomorrow'").title).toBe("Buy milk tomorrow");
    expect(parse('   "Buy milk tomorrow"   ').title).toBe("Buy milk tomorrow");
  });

  it("keeps the sigils off too, not just the dates", () => {
    const r = parse('"Read the C# book p1 #Work"');
    expect(r.title).toBe("Read the C# book p1 #Work");
    expect(r.projectId).toBeNull();
    expect(r.priority).toBeNull();
  });

  it("leaves an empty quoted line unsubmittable rather than crashing", () => {
    // QuickAdd's canSubmit is a non-empty title, so this disables the button.
    expect(parse('""').title).toBe("");
  });

  it("is not triggered by one quote, or by two that do not match", () => {
    expect(parse('"').title).toBe('"');
    expect(parse("\"Buy milk tomorrow'").title).not.toBe("Buy milk tomorrow");
  });

  it("does not swallow a quoted project name mid-sentence", () => {
    const r = parse('#"Casa e giardino" domani');
    expect(r.projectId).toBe(4);
    expect(ymd(due(r))).toBe("2026-09-10");
    expect(r.title).toBe("");
  });
});

describe('parseQuickAdd — "ore" alongside the sigils', () => {
  it("pulls the day, the time, the project and the priority out of one line", () => {
    // The offset map for the "ore" rewrite has to survive sigil masking too.
    const r = parse("dentista domenica ore 15 #Work p1");
    expect(r.title).toBe("dentista");
    expect(ymd(due(r))).toBe("2026-09-13");
    expect(hhmm(due(r))).toBe("15:00");
    expect(r.allDay).toBe(false);
    expect(r.projectId).toBe(3);
    expect(r.priority).toBe(4);
    expect(r.warnings).toEqual([]);
  });

  it("reports the span on the user's words, so the composer highlights them", () => {
    // The offsets come straight from chrono now. They used to come back through
    // an offset map, because "ore" was rewritten to the longer "alle" in a probe
    // string first - so this is the assertion that the provenance change kept
    // the span on what the user actually typed.
    const input = "dentista domenica ore 15 #Work p1";
    const r = parse(input);
    const sorted = [...r.spans].sort((a, b) => a.start - b.start);
    expect(sorted.map((s) => s.text)).toEqual(["domenica ore 15", "#Work", "p1"]);
    for (const span of sorted) {
      expect(input.slice(span.start, span.end)).toBe(span.text);
    }
  });
});

/*
 * The recurrence span decides two things at once: what the composer highlights,
 * and what `parse.ts` cuts out of the title. Until now only the title half was
 * pinned, so a span that drifted at either end would have been caught only when
 * it drifted far enough to take a neighbouring word with it.
 */
describe("parseQuickAdd — the recurrence span covers the phrase and nothing else", () => {
  const spansOf = (text: string) =>
    parse(text).spans.map((s) => [s.kind, s.text] as const);

  it("stops at the phrase, leaving the rest of the title alone", () => {
    expect(spansOf("Water the plants every day")).toEqual([["recurrence", "every day"]]);
    expect(spansOf("ping ogni 3 giorni p1")).toEqual([
      ["recurrence", "ogni 3 giorni"],
      ["priority", "p1"],
    ]);
  });

  it("takes the ! with it, since it is part of the token", () => {
    expect(spansOf("clean every! 2 weeks")).toEqual([["recurrence", "every! 2 weeks"]]);
  });

  it("does not swallow a weekday that belongs to the recurrence", () => {
    // "every monday" is one span. A span stopping at "every" would leave
    // "monday" for the date matcher and schedule a one-off alongside the repeat.
    expect(spansOf("Gym every monday #Work")).toEqual([
      ["recurrence", "every monday"],
      ["project", "#Work"],
    ]);
  });

  it("highlights nothing at all for a rejected repeat", () => {
    // The text stays whole and the warning explains it, so there is no
    // "recognised" run to paint - marking part of it would say the opposite.
    expect(spansOf("shift every workday at 9 starting monday")).toEqual([]);
  });
});

/*
 * QuickAdd.tsx runs parseQuickAdd inside a useMemo on EVERY keystroke, and the
 * leap-day retry is already windows x 9 years x parsers. Nothing measured that
 * until now.
 *
 * Typed prefix by prefix rather than by repeating one finished line: the cost
 * scales with input length and with which matchers a partial line wakes up, and
 * a half-typed "party 29 f" is a state a real user passes through. The median is
 * the assertion rather than the total, so one slow scheduling slice on a busy CI
 * box cannot fail the build while a genuine regression still will.
 */
describe("parseQuickAdd — stays inside a keystroke budget", () => {
  it("parses each prefix of a worst-case line well inside a frame", () => {
    const line = "party 29 feb please";
    const prefixes = Array.from({ length: line.length }, (_, i) => line.slice(0, i + 1));
    for (const prefix of prefixes) parse(prefix); // warm, so JIT is not the measurement

    const timings = prefixes.map((prefix) => {
      const started = performance.now();
      parse(prefix);
      return performance.now() - started;
    });

    const sorted = [...timings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    // Measured on the development machine: 1.08 ms for the full leap-day line,
    // 0.07 ms for a single character. 5 ms leaves room for a slower box.
    expect(median).toBeLessThan(5);
  });
});
