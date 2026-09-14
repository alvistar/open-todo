import * as chronoEn from "chrono-node/en";
import { type LanguagePack, lastDayOfMonth } from "../pack";

/*
 * A made-up language, for tests only. NEVER added to ACTIVE_PACKS.
 *
 * The claim this refactor makes is "adding a language is one new file". A test
 * that only checked the production packs could not tell that claim from "the two
 * languages that were always here still work". So this file exists to be the
 * third one, and the acceptance test drives it through the whole parser rather
 * than merely compiling it.
 *
 * It is deliberately AWKWARD, in the ways that broke things during the
 * extraction:
 *
 *   - single-entry lists everywhere, because a lone word is where the splice
 *     helpers go wrong: `zz\s+` directly quantified becomes `zz\s+?`, turning a
 *     greedy quantifier lazy, and a lone meridiem `pm` becomes `pm?`, an
 *     optional letter. Two packs each contributing two words hides both.
 *   - empty lists for the rows a language may legitimately lack, so the "a rule
 *     no pack feeds is dropped, not composed empty" path is exercised.
 *   - a weekday postfix but no prefix, the mirror image of English.
 *
 * It borrows chrono's English resolver, because what is under test is the
 * COMPOSITION - whether a pack's words reach the gate, the recurrence dispatch,
 * the masking and the title - not whether chrono can parse an invented language.
 *
 * Which forces a distinction the design docs did not spell out, and that writing
 * this file is what surfaced:
 *
 *   A PACK'S DATE VOCABULARY NARROWS WHAT ITS RESOLVER PRODUCED. IT NEVER
 *   CREATES MATCHES.
 *
 * §5 is an acceptor over chrono's output, so a date word whose resolver does not
 * know it is simply dead: chrono never offers the span, and the gate never gets
 * to admit it. Invented words work for the RECURRENCE rows and for
 * `nativePhrases`, because both of those are ours end to end and run without
 * chrono. They do not work for the date rows.
 *
 * So the date vocabulary below is real English, and the proof is the opposite
 * one: "sat" is a weekday chrono resolves and §5 deliberately REFUSES (it is
 * also the past tense - D-vocab). A pack that admits it gets a date where the
 * shipping registry gets a warning, from the same resolver on the same text.
 * That is the gate doing what a pack told it to.
 */
export const xx: LanguagePack = {
  code: "xx",
  preference: 9,
  resolver: chronoEn.GB,

  // The one §5 refuses on purpose, which is what makes it worth admitting here.
  weekdayFull: ["sat"],
  recurrenceOnlyAbbreviations: [],
  monthFull: ["may"],
  monthShort: ["jan"],

  relativeDay: ["today"],
  dayPart: ["morning"],
  // No prefix, one postfix: the mirror image of English, and a single-entry
  // splice in the position where a lone word goes wrong.
  weekdayPrefixes: [],
  weekdayPostfixes: ["next"],
  offsetPrepositions: ["in"],
  offsetWordNumbers: [],
  offsetUnits: ["days?"],
  nextPeriod: ["next\\s+week"],
  timePrepositions: ["at"],
  timePrepositionSuffixes: [],
  // EMPTY, so the "this language writes no meridiem" path is exercised: the
  // clock must still parse and "3pm" must stop being admissible.
  meridiem: [],

  every: ["zzevery"],
  listAnd: ["zzand"],
  ordinalWords: [],
  ordinalSuffixes: [],
  ordinalWeekdayTail: [],
  firstLast: ["zzlast"],
  ofThe: ["zzof"],
  monthNoun: ["zzmonth"],
  startingWords: [],
  monthOnTheNth: [],
  weekdayUnit: ["zzworkday"],
  otherWords: ["zzother"],
  countedUnits: {
    day: ["zzdays?"],
    week: ["zzweeks?"],
    month: ["zzmonths?"],
    year: ["zzyears?"],
  },
  singularUnits: {
    day: ["zzday"],
    week: ["zzweek"],
    month: ["zzmonth"],
    year: ["zzyear"],
  },
  adverbs: { day: [], week: [], month: [], year: [] },

  nativePhrases: [{ pattern: /\bzzendofmonth\b/i, resolve: lastDayOfMonth }],

  // Nothing invented here is an ordinary word in any language.
  inertCorpus: [],
  negativeCorpus: ["nothing at all here"],
};
