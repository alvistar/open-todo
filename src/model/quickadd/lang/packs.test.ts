import { describe, expect, it } from "vitest";
import { matchWhen } from "../datePhrase";
import {
  MONTH_ANY,
  MONTH_FULL,
  MONTH_SHORT,
  WEEKDAY_FULL,
  WEEKDAY_RECURRENCE,
  wordBounded,
} from "../vocabulary";
import { ACTIVE_PACKS } from "./index";

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
