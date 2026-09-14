/*
 * What one language contributes to the quick-add grammar.
 *
 * A pack holds WORDS, never finished regex shapes. The shapes are assembled by
 * the layers that consume them, from the words of every active pack at once, and
 * that is deliberate: §5's shapes are bilingual rather than per-language, so
 * "next venerdì" and "prossimo friday" both resolve today. Per-pack shapes would
 * silently drop every mixed combination, which is a §5 grammar amendment nobody
 * asked for.
 *
 * ---------------------------------------------------------------------------
 * The asymmetry below is load-bearing. It is D-vocab, not duplication, and it
 * is copied verbatim from the file this one replaced:
 *
 *   The two consumers deliberately admit different subsets, which is the whole
 *   reason this file states them separately rather than exporting one list:
 *
 *     - Recurrence admits the English short weekdays. "every sat" can only be
 *       Saturday, because "every" has already established that a weekday
 *       follows.
 *     - The date layer does NOT. A bare "sat" is also the English past tense,
 *       and "mar" is Italian for "sea" as often as it is Tuesday, so admitting
 *       them turns "I sat down with the team" into a task due Saturday named
 *       "I down with the team". D-vocab.
 *
 *   Neither admits the ITALIAN short weekdays. "ogni mar" reads as recurrence to
 *   a human, but §5 does not list it and adding it is a grammar amendment rather
 *   than a tidying-up, so it stays out until someone decides otherwise.
 *
 * So `recurrenceOnlyAbbreviations` is named for the constraint, not for the
 * content. An EMPTY array is a decision, never an oversight: Italian ships none.
 * ---------------------------------------------------------------------------
 *
 * Entries are regex SOURCE, not literals - `luned[iì]` accepts both spellings.
 * Two rules follow from that, and both fail silently when broken:
 *
 *   - No capturing groups. `recurrence.ts` reads its matches by POSITION, so one
 *     stray `(` in one pack rewires every rule's unit dispatch.
 *   - The gate lowercases and collapses whitespace before matching
 *     (`datePhrase.ts`, `normalise`), so an entry that is case-sensitive or
 *     carries a double space can never match anything.
 */
import type { Chrono } from "chrono-node";

/** The four repeat units Vikunja's `repeat_after` can express. */
export type Unit = "day" | "week" | "month" | "year";

/** One word list per unit. An empty list is a language that lacks the form. */
export type UnitWords = Record<Unit, string[]>;

/** Calendar parts of a day, in the user's zone. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** A phrase no chrono locale knows, with how it resolves. */
export interface NativePhrase {
  /** Unanchored. The leftmost match across ALL packs wins. */
  pattern: RegExp;
  resolve: (today: DateParts) => DateParts;
}

/** Day 0 of the next month is the last day of this one. */
export function lastDayOfMonth(today: DateParts): DateParts {
  return {
    year: today.year,
    month: today.month,
    day: new Date(Date.UTC(today.year, today.month, 0)).getUTCDate(),
  };
}

export interface LanguagePack {
  /** Stable id, for diagnostics and test names. Never shown to a user. */
  code: string;

  /**
   * Tie-break when two locales match the SAME span exactly. Lower wins.
   *
   * Explicit rather than array position, so inserting a language cannot silently
   * reorder the others. It only ever breaks an exact tie: earliest start and
   * then longest span are decided first, and `isAdmissible` has already thrown
   * out readings §5 does not accept. "Apr 30" is settled by that gate, not here.
   */
  preference: number;

  /**
   * What actually RESOLVES this language's phrases.
   *
   * Vocabulary alone resolves nothing: §5 is an acceptor over what some parser
   * produced, so a pack with words and no resolver would widen the gate without
   * ever contributing a date - a net loss.
   */
  resolver: Chrono;

  /** Full weekday names. BOTH layers admit these. */
  weekdayFull: string[];

  /** Read the block above before adding one of these. */
  recurrenceOnlyAbbreviations: string[];

  monthFull: string[];

  /**
   * Month abbreviations this pack CONTRIBUTES, which is not the same as every
   * abbreviation the language uses: where two languages spell one the same way,
   * exactly one pack carries it. "feb", "mar", "apr" and "nov" are Italian too
   * and live in the English pack, because listing them twice would put a
   * duplicate alternative in every composed pattern for no gain.
   *
   * Safe for the date layer in a way the weekday abbreviations are not, because
   * §5 only admits a month beside a day number: "30 apr" is a date, "apr" alone
   * is not.
   */
  monthShort: string[];

  /* ------------------------------------------------- §5.1 date shapes ---- */

  /** §5.1 "relative day" and "tonight". */
  relativeDay: string[];

  /** §5.1 "day part suffix": the words that may follow a day. */
  dayPart: string[];

  /**
   * What may stand BEFORE a weekday: "next venerdì", "prossimo friday".
   *
   * Kept apart from the weekday names, rather than shipped as a finished
   * "weekday phrase", because the two cross. §5's shapes are bilingual, so an
   * English prefix on an Italian weekday resolves today and must keep doing so.
   */
  weekdayPrefixes: string[];

  /** What may stand AFTER one: "venerdì prossimo". English has none. */
  weekdayPostfixes: string[];

  /** §5.1 "numeric offset": the prepositions, "in 3 days" / "tra 3 giorni". */
  offsetPrepositions: string[];

  /** Word forms of "one" admissible in an offset. English has none: §5 lists
   *  "tra un mese" but not "in a month". */
  offsetWordNumbers: string[];

  /** The units an offset may count. */
  offsetUnits: string[];

  /**
   * §5.1 "next period", as FINISHED fragments rather than words.
   *
   * The one row that cannot be composed from word lists: English has a single
   * word order ("next week"), Italian has two and an optional article
   * ("la settimana prossima", "prossima settimana"). A schema that fitted both
   * would be a schema built for exactly two languages.
   */
  nextPeriod: string[];

  /* -------------------------------------------------- §5.1 time row ------ */

  /** What introduces a clock time: "at 10", "alle 10", "ore 10". */
  timePrepositions: string[];

  /** A second preposition that may follow the first: "alle ore 15". */
  timePrepositionSuffixes: string[];

  /** "am", "pm". Empty for a language that writes no meridiem. */
  meridiem: string[];

  /* ------------------------------------------------- §5 recurrence ------- */

  /** The trigger. Everything below only applies after it. */
  every: string[];

  /** The word half of a list separator; the comma itself is the engine's. */
  listAnd: string[];

  /**
   * Word-form ordinals, which are as calendar-shaped as the digit ones and are
   * therefore REJECTED.
   *
   * TODO(F5): Italian ships none, so "ogni secondo martedì" matches neither the
   * reject list nor the accept list, falls through to the date layer, and is
   * silently scheduled as a one-off next Tuesday. Fixing it is a §5.1 amendment;
   * see known-defects.test.ts. Do not "complete" this list as a tidy-up.
   */
  ordinalWords: string[];

  /** Digit ordinal markers: "2nd", "2°". */
  ordinalSuffixes: string[];

  /** The tail of "every 2nd tuesday OF THE MONTH", kept in one span. */
  ordinalWeekdayTail: string[];

  /** "every LAST day of month". */
  firstLast: string[];

  /** The possessive in "last day OF month". */
  ofThe: string[];

  /** The noun in "last day of MONTH". */
  monthNoun: string[];

  /**
   * "every workday at 9 STARTING monday".
   *
   * TODO(F6): Italian ships none, so "ogni giorno a partire da lunedì" escapes
   * the reject list, matches the accept rule, AND lets the date layer take
   * "lunedì" - a repeat, a due date nobody asked for, and a task named after the
   * preposition. See known-defects.test.ts.
   */
  startingWords: string[];

  /** The whole tail of "every month ON THE 3rd". No word-for-word Italian. */
  monthOnTheNth: string[];

  /** "every WEEKDAY" - approximated to weekly, and warned about. */
  weekdayUnit: string[];

  /**
   * "every OTHER day" - the word that means twice the interval.
   *
   * It sits beside a SINGULAR unit, never a weekday: "every other monday" is an
   * ordinal weekday and stays rejected, which is what "every 2nd monday"
   * already is. A pack that has no such word ships an empty list and the rule
   * is dropped, not composed empty.
   */
  otherWords: string[];

  /** Units after a count: "every 3 DAYS". */
  countedUnits: UnitWords;

  /** Units on their own: "every DAY". */
  singularUnits: UnitWords;

  /**
   * "daily", "weekly"…
   *
   * TODO(F3): Italian ships none, so "quotidiano" and friends do nothing. Unlike
   * F5 and F6 this one fails safe - the phrase is simply not recognised.
   */
  adverbs: UnitWords;

  /* ------------------------------------------------- outside chrono ------ */

  /**
   * Phrases chrono has in NO locale, resolved here before it runs.
   *
   * These resolve in CALENDAR terms, in the user's zone. That is the whole
   * reason they are not chrono custom parsers: a parser sees `refDate` only as
   * an instant, and at 00:30 in Rome that instant is still the previous month in
   * UTC, so "end of month" would name the wrong month for half an hour a night.
   */
  nativePhrases: NativePhrase[];

  /**
   * Text this language's words would wrongly turn into a DATE, if §5 let them.
   *
   * These are RECOGNISED and refused: "I sat down with the team" gets a warning
   * naming "sat", because §5.1 decided a silent refusal there would leave the
   * user wondering where their word went. A warning is the intended treatment;
   * see `inertCorpus` for the text that must draw no reaction at all.
   */
  negativeCorpus: string[];

  /**
   * Ordinary prose the parser must not react to AT ALL - no date, no repeat, no
   * warning.
   *
   * This list exists because of a specific failure. Six recurrence fixes each
   * widened a pattern, each was gated on a zero-diff run over 4325 corpus
   * records, and each passed - yet nine of them shipped a false positive on
   * ordinary text. That corpus is a DATE corpus: it holds almost no prose
   * carrying a recurrence word, so the gate was blind to exactly the thing the
   * fixes could break. A gate proves what did NOT change; only counter-examples
   * prove what a new rule does not eat.
   *
   * SO: WIDEN A PATTERN, ADD TO THIS LIST IN THE SAME COMMIT. Every entry runs
   * through the whole registry and the whole parser, not just its own language.
   */
  inertCorpus: string[];
}
