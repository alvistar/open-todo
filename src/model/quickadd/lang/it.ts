import type { Chrono } from "chrono-node";
import * as chronoIt from "chrono-node/it";
import { type LanguagePack, lastDayOfMonth } from "./pack";

/*
 * "ore" is how Italian writes an appointment - "domenica ore 15" - and §5 lists
 * it. chrono's Italian locale does not know the word, so the phrase used to come
 * back as Sunday with no time and "ore 15" left sitting in the task name.
 *
 * This is fixed inside chrono rather than by rewriting the text before it. The
 * old fix built a probe string with "ore" replaced by "alle", parsed that, and
 * mapped every offset back; chrono's indices were then in probe coordinates and
 * nothing downstream was allowed to use them. Teaching chrono the word instead
 * means the indices are already the user's own, which deletes the probe, the
 * offset map, and the rule that guarded them.
 *
 * Two overrides, both on the pieces chrono exposes for exactly this:
 *
 *   - the date/time merge refiner decides what may sit BETWEEN a date and a
 *     time. Its list is `T|alle?|dopo\s*le|prima\s*delle?|,|-|.|∙|:` and "ore"
 *     was simply missing, which is why "domenica" and "15" never joined up.
 *   - the time parser's prefix decides what may introduce a clock time. It had
 *     "alle"/"dalle" and not "ore", so a bare "ore 9" produced no time at all.
 *
 * Neither class is exported and the package export map blocks a deep import, so
 * each is reached through the instance chrono itself built. They are identified
 * by the SOURCE of the regex they return, never by `constructor.name`: the
 * production bundle is minified by rolldown, which emits anonymous class
 * expressions, so every `constructor.name` there is the empty string and a
 * name-based lookup would silently match nothing while the tests still passed.
 * A regex source is a string literal and survives minification intact.
 *
 * `dopo\s*le` appears in exactly one of the four Italian refiners that expose
 * `patternBetween`, which is what makes it a safe discriminator - matching on
 * the method alone would also hit the relative-date and date-range mergers and
 * turn them into date/time mergers.
 */
const ORE_MERGE_PATTERN =
  /^\s*(T|alle?|(?:alle\s+)?ore|dopo\s*le|prima\s*delle?|,|-|\.|∙|:)?\s*$/;
const ORE_TIME_PREFIX = "(?:(?:alle?|dalle?|(?:alle\\s+)?ore)\\s*)??";

/** Shadows one method on a chrono part, leaving the original untouched. */
function overriding<T extends object>(part: T, methods: Partial<T>): T {
  return Object.assign(Object.create(part), methods) as T;
}

interface MergeRefiner {
  patternBetween(): RegExp;
}
interface TimeParser {
  primaryPrefix(): string;
}

const isDateTimeMerge = (part: unknown): part is MergeRefiner =>
  typeof (part as MergeRefiner).patternBetween === "function" &&
  /dopo\\s\*le/.test((part as MergeRefiner).patternBetween().source);

const isTimeParser = (part: unknown): part is TimeParser =>
  typeof (part as TimeParser).primaryPrefix === "function";

/** How many parts the patch actually replaced. Pinned by the tests. */
export const ORE_PATCH_COUNTS = { refiners: 0, parsers: 0 };

function italianWithOre(): Chrono {
  // Fresh instances, not the ones behind `chronoIt.casual`, so shadowing them
  // cannot leak into any other consumer of the locale.
  const config = chronoIt.configuration.createCasualConfiguration();

  config.refiners = config.refiners.map((refiner) => {
    if (!isDateTimeMerge(refiner)) return refiner;
    ORE_PATCH_COUNTS.refiners += 1;
    return overriding(refiner, { patternBetween: () => ORE_MERGE_PATTERN });
  });

  config.parsers = config.parsers.map((parser) => {
    if (!isTimeParser(parser)) return parser;
    ORE_PATCH_COUNTS.parsers += 1;
    return overriding(parser, { primaryPrefix: () => ORE_TIME_PREFIX });
  });

  return new chronoIt.Chrono(config);
}

export const it: LanguagePack = {
  code: "it",

  // Italian wins an exact tie: it is the owner's first language.
  preference: 0,
  resolver: italianWithOre(),

  // `[iì]` because both spellings are current, and people type both.
  weekdayFull: [
    "luned[iì]",
    "marted[iì]",
    "mercoled[iì]",
    "gioved[iì]",
    "venerd[iì]",
    "sabato",
    "domenica",
  ],

  /*
   * Empty ON PURPOSE, and this is the entry most likely to be "completed" by
   * someone tidying up. "ogni mar" reads as a recurrence to a human, but §5 does
   * not list it, "mar" is also the Italian for sea, and adding it is a grammar
   * amendment that needs an owner decision. See pack.ts.
   */
  recurrenceOnlyAbbreviations: [],

  monthFull: [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ],

  // Only the ones Italian does not share with English: "feb", "mar", "apr" and
  // "nov" are spelled the same in both and are carried by the English pack.
  monthShort: ["gen", "mag", "giu", "lug", "ago", "set", "ott", "dic"],

  relativeDay: ["oggi", "domani", "dopodomani", "stasera"],

  dayPart: ["mattina", "pomeriggio", "sera", "notte"],

  // Gender-inflected, and Italian puts it on either side of the weekday.
  weekdayPrefixes: ["prossim[ao]"],
  weekdayPostfixes: ["prossim[ao]"],

  offsetPrepositions: ["tra", "fra"],
  // "tra un mese" is §5; the English pack has no counterpart to these.
  offsetWordNumbers: ["un", "uno", "una"],
  offsetUnits: ["giorni", "giorno", "settimane", "settimana", "mesi", "mese"],

  // Two word orders and an optional article, which is why this row is a
  // fragment rather than a word list. See pack.ts.
  nextPeriod: [
    "(?:la\\s+|il\\s+|lo\\s+)?(?:settimana|mese)\\s+prossim[ao]",
    "prossim[ao]\\s+(?:settimana|mese)",
  ],

  timePrepositions: ["alle", "ore"],
  // "alle ore 15" carries both, and is how Italian writes an appointment most
  // formally.
  timePrepositionSuffixes: ["ore"],

  meridiem: [],

  every: ["ogni"],
  listAnd: ["e"],
  /*
   * Gender-inflected, like the weekday prefixes. "ultimo" and "primo" are here
   * AND in firstLast, exactly as "last" and "first" are in the English pack:
   * the two rules read different shapes out of the same words.
   *
   * "altr[oa]" makes "ogni altro lunedì" rejected, which is what "every other
   * monday" already is. It does NOT touch "ogni altro giorno", because this
   * rule needs a weekday after the ordinal and "giorno" is not one.
   */
  ordinalWords: [
    "prim[oa]",
    "second[oa]",
    "terz[oa]",
    "quart[oa]",
    "quint[oa]",
    "ultim[oa]",
    "altr[oa]",
    "prossim[oa]",
  ],
  // The Romance degree sign: "2° martedì".
  ordinalSuffixes: ["°"],
  // "ogni secondo martedì del mese" - the tail is kept inside the rejected span
  // so none of it survives to be re-read as a one-off date.
  ordinalWeekdayTail: ["del\\s+mese"],
  firstLast: ["ultimo", "primo"],
  ofThe: ["del"],
  monthNoun: ["mese"],
  /*
   * NOT the bare "da" or "dal", however natural "ogni giorno da lunedì" is.
   * The reject rule is `every <word> … <starting> [weekday]`, so a bare "da"
   * would reject "ogni giorno da fare" - an ordinary daily task whose text
   * happens to contain the commonest preposition in the language. The explicit
   * forms carry no such risk. A weekday-gated "da" is possible, but the pack
   * would have to know the weekday list, which is the engine's job.
   */
  startingWords: [
    // da / dal / dalla / dalle.
    "a\\s+partire\\s+da(?:l|ll[ae])?",
    "a\\s+cominciare\\s+da(?:l|ll[ae])?",
  ],
  monthOnTheNth: [],
  weekdayUnit: ["giorn[oi]\\s+ferial[ei]", "giorn[oi]\\s+lavorativ[oi]"],
  otherWords: ["altr[oa]"],
  countedUnits: {
    day: ["giorni?"],
    week: ["settimane?"],
    month: ["mesi", "mese"],
    year: ["anni?", "anno"],
  },
  singularUnits: {
    day: ["giorno"],
    week: ["settimana"],
    month: ["mese"],
    year: ["anno"],
  },
  /*
   * Italian had none, so "report mensilmente" set nothing while "report
   * monthly" set a monthly repeat. Like the English ones these match without
   * an every-word, which is why the list is short and unambiguous: each of
   * these words means a repeat interval and nothing else.
   */
  adverbs: {
    day: ["quotidianamente", "giornalmente"],
    week: ["settimanalmente"],
    month: ["mensilmente"],
    year: ["annualmente"],
  },

  nativePhrases: [{ pattern: /\bfine\s+mese\b/i, resolve: lastDayOfMonth }],

  negativeCorpus: [
    // "mar" is the sea at least as often as it is Tuesday.
    "il mar mosso",
    "il mar alle 10 mosso",
    // "ore" as an ordinary noun, not the time preposition.
    "ore di lavoro",
    // An offset in hours, which §5 excludes - and which must stay RECOGNISED,
    // so the warning can still explain itself.
    "chiama tra 2 ore",
    // A bare month name.
    "marzo report",
    // "fine settimana" is a period, not a day.
    "fine settimana",
  ],
};
