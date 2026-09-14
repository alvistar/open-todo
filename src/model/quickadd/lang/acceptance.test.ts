import { describe, expect, it } from "vitest";
import { parseQuickAddWith, type QuickAddContext } from "../parse";
import { matchRecurrenceWith } from "../recurrence";
import { xx } from "./__fixtures__/xx";
import { ACTIVE_PACKS } from "./index";

/*
 * THE ACCEPTANCE TEST FOR THE WHOLE REFACTOR.
 *
 * The claim is that adding a language is ONE NEW FILE. Every other test here
 * checks that the two languages which were always present still work, which
 * cannot tell that claim from "nothing was broken".
 *
 * So this drives a third pack - `__fixtures__/xx.ts`, an invented language,
 * never in ACTIVE_PACKS - through the real `parseQuickAdd`, and asserts it
 * reaches resolution, the §5 gate, recurrence dispatch, sigil masking and title
 * extraction. Compiling is not the bar: a pack that composed into a valid
 * pattern and never reached the resolver would pass a compile-only check and be
 * useless.
 *
 * IF THIS FILE EVER NEEDS parse.ts, datePhrase.ts, recurrence.ts, grammar.ts OR
 * vocabulary.ts TO CHANGE, the claim is false and the design needs revisiting.
 */

const TZ = "Europe/Rome";
const NOW = new Date("2026-09-09T08:00:00Z");

const ctx = (): QuickAddContext => ({
  now: NOW,
  timeZone: TZ,
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [{ id: 3, title: "Work" }],
  labels: [],
});

const soloXx = [xx];
const parse = (text: string) => parseQuickAddWith(soloXx, text, ctx());

const ymd = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

describe("a pack decides what the shared gate admits", () => {
  /*
   * The strongest proof available: SAME resolver, SAME text, different pack,
   * different answer. "gym sat" is refused by the shipping grammar because a
   * bare "sat" is the English past tense as often as it is Saturday (D-vocab),
   * and admitted by a pack that lists it. Nothing but the registry changed.
   */
  it("admits a weekday the shipping grammar refuses", () => {
    const mine = parse("gym sat");
    expect(mine.dueDate).not.toBeNull();
    expect(mine.title).toBe("gym");
  });

  it("and the shipping grammar still refuses it, and says so", () => {
    const theirs = parseQuickAddWith(ACTIVE_PACKS, "gym sat", ctx());
    expect(theirs.dueDate).toBeNull();
    expect(theirs.title).toBe("gym sat");
    expect(theirs.warnings).toHaveLength(1);
  });

  it("resolves its relative day and cuts it from the title", () => {
    const r = parse("buy milk today");
    expect(ymd(r.dueDate as Date)).toBe("2026-09-09");
    expect(r.title).toBe("buy milk");
  });

  it("carries its own time preposition onto its own weekday", () => {
    const r = parse("standup sat at 10");
    expect(r.allDay).toBe(false);
    expect(r.title).toBe("standup");
  });

  it("a pack with no meridiem cannot be given one", () => {
    // `meridiem: []`. The clock still parses, but "3pm" is no longer a shape
    // this grammar admits - and the composed pattern must not have collapsed
    // into something that matches anything.
    expect(parse("standup sat at 10").dueDate).not.toBeNull();
    expect(parse("standup sat at 3pm").dueDate).toBeNull();
  });
});

describe("the layers that are ours end to end take invented words", () => {
  /*
   * Recurrence and nativePhrases never reach chrono, so a pack can use words no
   * resolver has heard of. This is where an invented language is genuinely
   * testable, and it is the half of the parser §5's acceptor does not gate.
   */
  it("resolves a phrase chrono has in no locale", () => {
    const r = parse("invoice zzendofmonth");
    expect(ymd(r.dueDate as Date)).toBe("2026-09-30");
    expect(r.title).toBe("invoice");
  });

  it("drives its own recurrence dispatch", () => {
    const r = parse("water plants zzevery zzday");
    expect(r.repeatAfter).toBe(24 * 60 * 60);
    expect(r.title).toBe("water plants");
  });

  it("counts units in its own words", () => {
    expect(matchRecurrenceWith(soloXx, "ping zzevery 3 zzdays")).toMatchObject({
      repeatAfter: 3 * 24 * 60 * 60,
    });
  });

  it("doubles an interval with its own other-word", () => {
    expect(matchRecurrenceWith(soloXx, "ping zzevery zzother zzday")).toMatchObject({
      repeatAfter: 2 * 24 * 60 * 60,
    });
  });

  it("rejects what Vikunja cannot store, in its own words", () => {
    expect(
      matchRecurrenceWith(soloXx, "x zzevery zzlast whatever zzof zzmonth"),
    ).toMatchObject({ rejected: true });
  });

  it("still masks the sigils, which belong to no language", () => {
    const r = parse("ping today #Work p1");
    expect(r.projectId).toBe(3);
    expect(r.priority).toBe(4);
    expect(r.title).toBe("ping");
  });
});

describe("the fixture pack stays out of the product", () => {
  it("is not registered", () => {
    expect(ACTIVE_PACKS.some((p) => p.code === "xx")).toBe(false);
  });

  it("and its recurrence words mean nothing to the real parser", () => {
    // Proves the assertions above came from the injected registry rather than
    // from some global the fixture quietly joined.
    const r = parseQuickAddWith(ACTIVE_PACKS, "water plants zzevery zzday", ctx());
    expect(r.repeatAfter).toBeUndefined();
    expect(r.title).toBe("water plants zzevery zzday");
  });
});
