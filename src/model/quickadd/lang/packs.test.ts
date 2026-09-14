import { describe, expect, it } from "vitest";
import { matchWhen } from "../datePhrase";
import {
  compileDateGrammar,
  compileRecurrenceGrammar,
  DATE_GRAMMAR,
  RECURRENCE_GRAMMAR,
} from "../grammar";
import { matchRecurrence } from "../recurrence";
import {
  MONTH_ANY,
  MONTH_FULL,
  MONTH_SHORT,
  WEEKDAY_FULL,
  WEEKDAY_RECURRENCE,
  wordBounded,
} from "../vocabulary";
import { ACTIVE_PACKS } from "./index";
import type { LanguagePack } from "./pack";

const TZ = "Europe/Rome";
const NOW = new Date("2026-09-09T08:00:00Z");

/*
 * The extraction gate.
 *
 * The words moved out of vocabulary.ts into one file per language. Nothing about
 * the grammar was meant to change, and the cheapest possible proof of that is
 * not a behaviour run: it is that the composed alternations are the SAME STRING
 * they were when they were hand-written. If these pass, no consumer downstream
 * can behave differently, without the parser having to be executed at all.
 *
 * The literals below are therefore frozen on purpose. Do not regenerate them
 * from the packs - that would make the test assert that the code equals itself.
 * Changing one means changing the grammar, which is a §5.1 amendment and needs
 * an owner decision.
 */
describe("the composed vocabulary is byte-identical to the hand-written lists", () => {
  it("WEEKDAY_FULL", () => {
    expect(WEEKDAY_FULL).toBe(
      "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
        "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica",
    );
  });

  it("WEEKDAY_RECURRENCE — the full names, then the abbreviations", () => {
    expect(WEEKDAY_RECURRENCE).toBe(`${WEEKDAY_FULL}|mon|tue|wed|thu|fri|sat|sun`);
  });

  it("MONTH_FULL", () => {
    expect(MONTH_FULL).toBe(
      "january|february|march|april|may|june|july|august|september|october|november|december|" +
        "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre",
    );
  });

  it("MONTH_SHORT", () => {
    expect(MONTH_SHORT).toBe(
      "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|gen|mag|giu|lug|ago|set|ott|dic",
    );
  });

  it("MONTH_ANY", () => {
    expect(MONTH_ANY).toBe(`${MONTH_FULL}|${MONTH_SHORT}`);
  });

  it("wordBounded", () => {
    expect(wordBounded("x")).toBe("(?:x)(?!\\p{L})");
  });
});

/*
 * The shape of a composed alternation, rather than its content. These are the
 * ways a composition breaks SILENTLY: an empty contribution leaves a dangling
 * `|`, which matches the empty string, and an alternation that matches the empty
 * string turns the §5 acceptor from a gate into a door.
 */
describe("composition cannot produce a pattern that matches everything", () => {
  const composed = {
    WEEKDAY_FULL,
    WEEKDAY_RECURRENCE,
    MONTH_FULL,
    MONTH_SHORT,
    MONTH_ANY,
  };

  it("never has an empty alternative", () => {
    for (const [name, value] of Object.entries(composed)) {
      expect(value.startsWith("|"), name).toBe(false);
      expect(value.endsWith("|"), name).toBe(false);
      expect(value.includes("||"), name).toBe(false);
    }
  });

  it("never matches the empty string", () => {
    for (const [name, value] of Object.entries(composed)) {
      expect(new RegExp(`^(?:${value})$`, "iu").test(""), name).toBe(false);
    }
  });

  it("adds no capturing group, which recurrence.ts reads by position", () => {
    for (const pack of ACTIVE_PACKS) {
      const entries = [
        ...pack.weekdayFull,
        ...pack.recurrenceOnlyAbbreviations,
        ...pack.monthFull,
        ...pack.monthShort,
      ];
      for (const entry of entries) {
        // `(x|)` has exactly one group; an entry adding one would make it two.
        const groups = new RegExp(`(?:${entry})|`).exec("")?.length;
        expect(groups, `${pack.code}: ${entry}`).toBe(1);
      }
    }
  });
});

describe("the pack decisions that look like omissions", () => {
  it("Italian contributes no weekday abbreviations, deliberately", () => {
    // "ogni mar" reads as a recurrence to a human. §5 does not list it, "mar" is
    // also the sea, and adding it is a grammar amendment. See lang/pack.ts.
    const italian = ACTIVE_PACKS.find((p) => p.code === "it");
    expect(italian?.recurrenceOnlyAbbreviations).toEqual([]);
  });

  it("every pack carries counter-examples", () => {
    for (const pack of ACTIVE_PACKS) {
      expect(pack.negativeCorpus.length, pack.code).toBeGreaterThan(0);
    }
  });
});

/*
 * Every pack's counter-examples, run through the WHOLE registry rather than
 * through their own language.
 *
 * This is the test that makes adding a language file safe. The §5 gate is
 * language-blind: a new pack's words are admitted for all text, so the risk is
 * never what the new language does to its own phrases - it is what it does to
 * every other language's. Reading one pack in isolation cannot show that.
 */
describe("no pack puts a date on another pack's ordinary words", () => {
  for (const pack of ACTIVE_PACKS) {
    for (const phrase of pack.negativeCorpus) {
      it(`${pack.code}: ${JSON.stringify(phrase)} is not a date`, () => {
        expect(matchWhen(phrase, NOW, TZ).when).toBeNull();
      });
    }
  }
});

/*
 * The §5.1 shapes, composed from the packs' words by templates the engine owns.
 * Frozen against what they were when each row was a hand-written literal, for
 * the same reason as the vocabulary above: if the string is the same, nothing
 * downstream can behave differently.
 *
 * ACCEPTED_SHAPE is checked whole rather than row by row. The rows are spliced
 * into one another, so a grouping mistake in any of them shows up here - and
 * grouping is exactly what goes wrong: `(?:a|b)?` and `a?` mean different things
 * the moment a pack ships one word instead of two.
 */
describe("the composed §5.1 shapes are byte-identical to the literals they replaced", () => {
  it("ACCEPTED_SHAPE", () => {
    expect(DATE_GRAMMAR.ACCEPTED_SHAPE.source).toBe(
      "^(?:(?:today|tomorrow|tonight|oggi|domani|dopodomani|stasera|" +
        "(?:next\\s+|prossim[ao]\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
        "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)(?:\\s+prossim[ao])?)" +
        "(?:\\s+(?:morning|afternoon|evening|night|mattina|pomeriggio|sera|notte))?|" +
        "(?:in|tra|fra)\\s+(?:\\d+|un|uno|una)\\s+" +
        "(?:days?|weeks?|months?|giorni|giorno|settimane|settimana|mesi|mese)|" +
        "next\\s+(?:week|month)|(?:la\\s+|il\\s+|lo\\s+)?(?:settimana|mese)\\s+prossim[ao]|" +
        "prossim[ao]\\s+(?:settimana|mese)|" +
        `(?:\\d{1,2}\\s+(?:${MONTH_ANY})|(?:${MONTH_ANY})\\s+\\d{1,2})(?:\\s+\\d{4})?|` +
        "\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2})" +
        "(?:\\s+(?:at|alle|ore)(?:\\s+ore)?\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|" +
        "\\s+\\d{1,2}:\\d{2}|\\s*\\d{1,2}\\s*(?:am|pm))?$",
    );
    expect(DATE_GRAMMAR.ACCEPTED_SHAPE.flags).toBe("iu");
  });

  it("NAMES_A_MONTH", () => {
    expect(DATE_GRAMMAR.NAMES_A_MONTH.source).toBe(`\\b${wordBounded(MONTH_ANY)}`);
    expect(DATE_GRAMMAR.NAMES_A_MONTH.flags).toBe("iu");
  });

  it("TIME_MARKER — one union over the user's text, and still plain `i`", () => {
    expect(DATE_GRAMMAR.TIME_MARKER.source).toBe(
      ":|\\d\\s*(?:am|pm)\\b|\\b(?:at|alle|ore)\\b",
    );
    // Not "iu". Nothing here needs \p{L}, and adding u changes escape handling.
    expect(DATE_GRAMMAR.TIME_MARKER.flags).toBe("i");
  });
});

/*
 * The splice rules from grammar.ts, exercised on a registry of one.
 *
 * Every shape above is composed from TWO packs, so a helper that only breaks on
 * a single-entry list would pass everything. These are the cases that catch
 * `next\s+?` and `am?`.
 */
describe("a one-pack registry composes into valid patterns", () => {
  const solo = ACTIVE_PACKS.filter((p) => p.code === "en");

  it("does not turn a lone prefix's quantifier lazy", () => {
    const { ACCEPTED_SHAPE } = compileDateGrammar(solo);
    expect(ACCEPTED_SHAPE.source).toContain("(?:next\\s+)?");
    expect(ACCEPTED_SHAPE.source).not.toContain("next\\s+?");
  });

  it("still refuses what §5 refuses, with one pack as with two", () => {
    const { ACCEPTED_SHAPE } = compileDateGrammar(solo);
    expect(ACCEPTED_SHAPE.test("")).toBe(false);
    expect(ACCEPTED_SHAPE.test("sat")).toBe(false);
    expect(ACCEPTED_SHAPE.test("tomorrow")).toBe(true);
    expect(ACCEPTED_SHAPE.test("next friday")).toBe(true);
  });
});

/*
 * Native phrases are resolved before chrono, and the LEFTMOST match wins.
 *
 * A single combined regex gave that for free. Iterating the packs and returning
 * on the first that matched would let registry order decide, which is a
 * regression on any line carrying both languages' phrase - and the patterns do
 * not have to overlap for it to happen.
 */
describe("native phrases resolve leftmost, not by registry order", () => {
  it("takes whichever phrase comes first in the text", () => {
    const both = matchWhen("end of month fine mese", NOW, TZ).when;
    expect(both?.text).toBe("end of month");

    const reversed = matchWhen("fine mese end of month", NOW, TZ).when;
    expect(reversed?.text).toBe("fine mese");
  });

  it("resolves the same day either way", () => {
    const a = matchWhen("end of month fine mese", NOW, TZ).when;
    const b = matchWhen("fine mese end of month", NOW, TZ).when;
    expect(a?.date.getTime()).toBe(b?.date.getTime());
  });
});

/*
 * The recurrence grammar, composed the same way and pinned the same way.
 *
 * The ordering assertion is the one that matters most. REJECTED-before-accepted
 * is global, not per pack: "every last day of month" also contains the substring
 * "month", so an accepted rule running first matches it and rounds a
 * calendar-shaped repeat to monthly in silence. A composition that interleaved
 * per pack -- for each pack, its rejects then its accepts -- would still compile,
 * still match, and be wrong only for the phrases the rejects exist to catch.
 */
/*
 * "Byte-identical" means identical to the hand-written literals this
 * composition replaced, EXCEPT where a named fix has since amended the grammar
 * on purpose. Each such row carries the finding that changed it. A row that
 * moves without a comment naming a finding is a refactor that changed behaviour.
 */
describe("the composed recurrence patterns are byte-identical", () => {
  const EVERY = "(?:every|ogni)";
  const WD =
    "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
    "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|" +
    "mon|tue|wed|thu|fri|sat|sun)(?!\\p{L})";
  const LIST_ITEM = `(?:${WD}|\\d{1,2}(?![\\d\\p{L}]))`;

  it("REJECTED, in order and complete", () => {
    expect(RECURRENCE_GRAMMAR.REJECTED.map((r: RegExp) => r.source)).toEqual([
      // F4 widened this one: a list item may be a day-of-month number, not only
      // a weekday. "ogni 5,6" matched nothing at all and said nothing, where
      // "every mon, wed" has always been refused and explained.
      `\\b${EVERY}\\s+${LIST_ITEM}\\s*(?:,|and|e)\\s*${LIST_ITEM}`,
      // F5 widened this one: the ordinal WORDS and the "of the month" tail were
      // English-only, so "ogni secondo martedì" fell through to the date layer
      // and became a one-off. The shape is unchanged; the vocabulary is not.
      `\\b${EVERY}\\s+(?:\\d+(?:st|nd|rd|th|°)?|second|third|fourth|fifth|last|first|other|next|` +
        `prim[oa]|second[oa]|terz[oa]|quart[oa]|quint[oa]|ultim[oa]|altr[oa]|prossim[oa])` +
        `\\s+${WD}(?:\\s+(?:of\\s+(?:the\\s+)?month|del\\s+mese))?`,
      `\\b${EVERY}\\s+(?:last|first|ultimo|primo)\\s+\\w+\\s+(?:of|del)\\s+(?:month|mese)`,
      // F6 widened this one: the starting-word was English-only, so "ogni
      // giorno a partire da lunedì" kept its daily repeat AND gained a one-off
      // due date, with "a partire da" left as the title.
      `\\b${EVERY}\\s+\\w+.*?\\b(?:starting|a\\s+partire\\s+da(?:l|ll[ae])?` +
        `|a\\s+cominciare\\s+da(?:l|ll[ae])?)\\b(?:\\s+${WD})?`,
      `\\b${EVERY}\\s+(?:month|mese)\\s+on\\s+the\\s+\\d+(?:st|nd|rd|th)?`,
    ]);
  });

  it("the accepted rules", () => {
    const g = RECURRENCE_GRAMMAR;
    // F3 widened this one: "workday" and "working day" mean the same thing to a
    // user and took the same approximation, but only "weekday" was in the
    // grammar. Italian gained the plural and "giorni lavorativi".
    expect(g.WEEKDAY_UNIT.source).toBe(
      `\\b${EVERY}!?\\s+(?:weekdays?|work\\s*days?|working\\s+days?` +
        `|giorn[oi]\\s+ferial[ei]|giorn[oi]\\s+lavorativ[oi])\\b`,
    );
    expect(g.COUNTED.source).toBe(
      `\\b${EVERY}(!?)\\s+(\\d{1,3})\\s+(days?|giorni?|weeks?|settimane?|months?|mesi|mese|years?|anni?|anno)\\b`,
    );
    // F2 added this one: "every other day" is "every 2 days", which Vikunja
    // stores exactly, and which fell through both lists in silence.
    expect(g.OTHER?.source).toBe(
      `\\b${EVERY}(!?)\\s+(?:other|altr[oa])\\s+` +
        "(day|giorno|week|settimana|month|mese|year|anno)\\b",
    );
    expect(g.BARE_WEEKDAY.source).toBe(`\\b${EVERY}(!?)\\s+${WD}`);
    expect(g.SINGULAR.source).toBe(
      `\\b${EVERY}(!?)\\s+(day|giorno|week|settimana|month|mese|year|anno)\\b`,
    );
    // F3 again: Italian had no adverbs at all, so "report mensilmente" set
    // nothing where "report monthly" set a monthly repeat.
    expect(g.ADVERB?.source).toBe(
      "\\b(daily|quotidianamente|giornalmente|weekly|settimanalmente" +
        "|monthly|mensilmente|yearly|annually|annualmente)\\b",
    );
    // Plain `i`, like the literal it replaced. Nothing in it needs \p{L}.
    expect(g.ADVERB?.flags).toBe("i");
  });

  it("rejects before it accepts, whatever the registry order", () => {
    // The case the ordering exists for: this contains "month", which the
    // singular-unit rule would otherwise match.
    expect(matchRecurrence("ogni ultimo giorno del mese")).toMatchObject({
      rejected: true,
    });
    expect(matchRecurrence("payroll every last day of month")).toMatchObject({
      rejected: true,
    });
  });

  it("drops a rule no pack feeds, rather than composing an empty one", () => {
    /*
     * A rule no pack feeds must VANISH, not become a pattern that matches
     * nothing -- or, far worse, everything.
     *
     * This used to run against the Italian pack, which had no adverbs until F3
     * filled them in. Both shipping packs now feed every rule, which is the
     * point of the refactor, so the case is made with a pack that deliberately
     * ships nothing for two rows.
     */
    const bare: LanguagePack = {
      ...(ACTIVE_PACKS.find((p) => p.code === "it") as LanguagePack),
      adverbs: { day: [], week: [], month: [], year: [] },
      startingWords: [],
      otherWords: [],
    };
    const g = compileRecurrenceGrammar([bare]);
    expect(g.ADVERB).toBeNull();
    expect(g.OTHER).toBeNull();
    expect(g.REJECTED.every((r: RegExp) => !r.source.includes("starting"))).toBe(true);
    expect(g.REJECTED.every((r: RegExp) => !r.source.includes("partire"))).toBe(true);
    for (const pattern of g.REJECTED) expect(pattern.test("")).toBe(false);
  });
});
