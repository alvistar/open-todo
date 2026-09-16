/*
 * The §5.1 acceptor, compiled from the active language packs.
 *
 * chrono resolves; §5 decides what is admissible. chrono's vocabulary is far
 * wider than ours and cannot be configured per word, so left alone it reads
 * "sat" in "I sat down with the team" as Saturday and "mar" in "il mar mosso"
 * as Tuesday - and because parse.ts removes whatever matched from the title,
 * the user loses a word AND gains a date they never asked for.
 *
 * Each constant below is one row of the §5.1 table. Keep them in that order,
 * keep the names matching, and keep one `union` per row, so the table, the rows
 * and every pack's fields can all be diffed by reading.
 *
 * THE PACKS SUPPLY WORDS; THE ROWS HERE SUPPLY SHAPE. That split is the whole
 * design and it is not the obvious one. §5's shapes are bilingual: "next
 * venerdì" and "prossimo friday" both resolve, because the prefixes and the
 * weekday names cross. If each pack shipped a finished "weekday phrase" instead,
 * every mixed combination would disappear, silently, and that is a grammar
 * amendment rather than a refactor. `nextPeriod` is the single row that cannot
 * be composed this way, and it is a per-pack fragment for a stated reason.
 */

import { ACTIVE_PACKS } from "./lang";
import type { LanguagePack, NativePhrase, Unit, UnitWords } from "./lang/pack";

/*
 * Three ways to splice a word list into a pattern. WHICH ONE IS CORRECT DEPENDS
 * ON THE POSITION, and picking the wrong one is a bug, not a formatting choice:
 *
 *   alternatives()  bare `a|b`. Only where an explicit group already surrounds
 *                   it, e.g. inside `(?:X|Y)`.
 *   oneOf()         bare when there is one, `(?:a|b)` when there are several.
 *                   For a position whose group is written out, e.g. `(?:\s+X)?`
 *                   — the surrounding group binds the quantifier, so a lone
 *                   entry needs no group of its own.
 *   group()         always `(?:a|b)`. For a position where a QUANTIFIER ATTACHES
 *                   DIRECTLY, e.g. `X?`. A bare single entry there is silently
 *                   wrong: `next\s+` becomes `next\s+?`, turning a greedy
 *                   quantifier lazy, and `am` becomes `am?`, an optional "m".
 *
 * All three return null for an empty list rather than "". An empty alternation
 * spliced into a pattern leaves a dangling `|` or an empty group, both of which
 * match the EMPTY STRING and turn this gate from a door into an open one.
 * Callers must decide what absence means; it is never silently nothing.
 */
function alternatives(parts: readonly string[]): string | null {
  return parts.length === 0 ? null : parts.join("|");
}

function oneOf(parts: readonly string[]): string | null {
  if (parts.length === 0) return null;
  return parts.length === 1 ? (parts[0] as string) : `(?:${parts.join("|")})`;
}

function group(parts: readonly string[]): string | null {
  return parts.length === 0 ? null : `(?:${parts.join("|")})`;
}

const union = (packs: readonly LanguagePack[], pick: (p: LanguagePack) => string[]) =>
  packs.flatMap(pick);

/**
 * Closes an alternation against a longer word. Without it the alternative
 * "mon" matches the start of "month", and `every 2 months` — an accepted
 * recurrence — was rejected as a weekday list.
 */
export function wordBounded(alternation: string): string {
  return `(?:${alternation})(?!\\p{L})`;
}

/*
 * The shared name lists, composed FROM THE PACKS PASSED IN.
 *
 * These used to be read from vocabulary.ts, whose exports are bound to the
 * shipping registry. That made two rows of the grammar silently unparameterised:
 * `compileDateGrammar(somePacks)` returned a pattern carrying the PRODUCTION
 * weekday and month lists. Nothing in the two shipping languages could show it,
 * because they are the production registry. The fixture-pack acceptance test is
 * what found it.
 */
export const weekdayFullOf = (packs: readonly LanguagePack[]) =>
  required(alternatives(union(packs, (p) => p.weekdayFull)), "weekdayFull");

export const weekdayRecurrenceOf = (packs: readonly LanguagePack[]) => {
  const abbreviations = alternatives(union(packs, (p) => p.recurrenceOnlyAbbreviations));
  const full = weekdayFullOf(packs);
  return abbreviations === null ? full : `${full}|${abbreviations}`;
};

export const monthFullOf = (packs: readonly LanguagePack[]) =>
  required(alternatives(union(packs, (p) => p.monthFull)), "monthFull");

export const monthShortOf = (packs: readonly LanguagePack[]) =>
  required(alternatives(union(packs, (p) => p.monthShort)), "monthShort");

export const monthAnyOf = (packs: readonly LanguagePack[]) =>
  `${monthFullOf(packs)}|${monthShortOf(packs)}`;

/** For a row every pack must feed: absence is a broken registry, not a choice. */
function required(value: string | null, row: string): string {
  if (value === null) throw new Error(`quickadd grammar: no pack contributes ${row}`);
  return value;
}

export interface DateGrammar {
  /** The §5.1 gate. Applied to every candidate before the sort. */
  ACCEPTED_SHAPE: RegExp;
  /** Whether a span names a month at all. */
  NAMES_A_MONTH: RegExp;
  /** Whether the USER'S OWN TEXT marked a clock time. */
  TIME_MARKER: RegExp;
  /** Phrases resolved before chrono runs. Leftmost match across all packs wins. */
  NATIVE_PHRASES: NativePhrase[];
  /**
   * A span that is only a bare unit noun, with or without the words that
   * ordinarily sit in front of one. See `isBareUnit` in datePhrase.ts.
   */
  BARE_UNIT: RegExp;
}

/*
 * The words that may sit in front of a bare unit noun without making it a date.
 * Articles and the prepositions chrono drags in. Engine-owned rather than
 * per pack: they carry no date meaning on their own, and a pack that omitted
 * one would get a warning it did not choose.
 */
const LEADING_WORDS = "the|a|an|in|il|lo|la|un|uno|una|nel|nella";

export function compileDateGrammar(packs: readonly LanguagePack[]): DateGrammar {
  const WEEKDAY_FULL = weekdayFullOf(packs);
  const MONTH_ANY = monthAnyOf(packs);

  /* ---------------------------------------------------- §5.1 rows ------- */

  // Bare: DAY_SHAPE's own `(?:…|…)` is the group.
  const RELATIVE_DAY = required(
    alternatives(union(packs, (p) => p.relativeDay)),
    "relativeDay",
  );

  /*
   * Only the full weekday names - see the note in lang/pack.ts. The prefix and
   * postfix are separate rows on purpose: they cross every pack's weekdays.
   */
  // group(), not oneOf(): the `?` attaches straight to it.
  const WEEKDAY_PREFIX = group(
    union(packs, (p) => p.weekdayPrefixes).map((w) => `${w}\\s+`),
  );
  const WEEKDAY_POSTFIX = oneOf(union(packs, (p) => p.weekdayPostfixes));
  const WEEKDAY_PHRASE =
    `${WEEKDAY_PREFIX === null ? "" : `${WEEKDAY_PREFIX}?`}` +
    `(?:${WEEKDAY_FULL})` +
    `${WEEKDAY_POSTFIX === null ? "" : `(?:\\s+${WEEKDAY_POSTFIX})?`}`;

  const DAY_PART = required(oneOf(union(packs, (p) => p.dayPart)), "dayPart");

  const DAY_SHAPE = `(?:${RELATIVE_DAY}|${WEEKDAY_PHRASE})(?:\\s+${DAY_PART})?`;

  /** "in 3 days", "tra un mese", "fra 2 settimane". */
  const OFFSET_PREPOSITION = required(
    oneOf(union(packs, (p) => p.offsetPrepositions)),
    "offsetPrepositions",
  );
  const OFFSET_COUNT = required(
    // The digits are the engine's; the word forms are the packs'.
    oneOf(["\\d+", ...union(packs, (p) => p.offsetWordNumbers)]),
    "offsetWordNumbers",
  );
  const OFFSET_UNIT = required(oneOf(union(packs, (p) => p.offsetUnits)), "offsetUnits");
  const OFFSET_SHAPE = `${OFFSET_PREPOSITION}\\s+${OFFSET_COUNT}\\s+${OFFSET_UNIT}`;

  /** "next week", "la settimana prossima", "prossimo mese". Fragments, not words. */
  const NEXT_PERIOD_SHAPE = required(
    alternatives(union(packs, (p) => p.nextPeriod)),
    "nextPeriod",
  );

  /** A month name always needs a day number beside it: "apr" alone is a period. */
  const MONTH_DAY_SHAPE = `(?:\\d{1,2}\\s+(?:${MONTH_ANY})|(?:${MONTH_ANY})\\s+\\d{1,2})(?:\\s+\\d{4})?`;

  const ISO_SHAPE = "\\d{4}-\\d{2}-\\d{2}";

  /** Day-first, which is what §5 specifies. chrono's it and en-GB both agree. */
  const SLASH_SHAPE = "\\d{1,2}/\\d{1,2}";

  /* ----------------------------------------------------- §5 time row ---- */

  // group(): `${MERIDIEM}?` would otherwise make a lone "am" an optional "m".
  const MERIDIEM = group(union(packs, (p) => p.meridiem));
  const CLOCK = `\\d{1,2}(?::\\d{2})?\\s*${MERIDIEM === null ? "" : `${MERIDIEM}?`}`;

  const TIME_PREPOSITION_WORD = required(
    oneOf(union(packs, (p) => p.timePrepositions)),
    "timePrepositions",
  );
  const TIME_PREPOSITION_SUFFIX = oneOf(union(packs, (p) => p.timePrepositionSuffixes));
  const TIME_PREPOSITION =
    TIME_PREPOSITION_SUFFIX === null
      ? TIME_PREPOSITION_WORD
      : `${TIME_PREPOSITION_WORD}(?:\\s+${TIME_PREPOSITION_SUFFIX})?`;

  const TIME_CLAUSE =
    `(?:\\s+${TIME_PREPOSITION}\\s+${CLOCK}` +
    "|\\s+\\d{1,2}:\\d{2}" +
    `${MERIDIEM === null ? "" : `|\\s*\\d{1,2}\\s*${MERIDIEM}`})?`;

  const ACCEPTED_SHAPE = new RegExp(
    `^(?:${DAY_SHAPE}|${OFFSET_SHAPE}|${NEXT_PERIOD_SHAPE}|${MONTH_DAY_SHAPE}|${ISO_SHAPE}|${SLASH_SHAPE})${TIME_CLAUSE}$`,
    "iu",
  );

  /*
   * Not part of ACCEPTED_SHAPE: used to refuse a month name whose day chrono
   * merely implied, and to pick the window for the leap-day retry.
   */
  const NAMES_A_MONTH = new RegExp(`\\b${wordBounded(MONTH_ANY)}`, "iu");

  /*
   * A clock time only counts when the text marks one, as it did before chrono.
   * "3pm" has no word boundary before "pm", so the meridiem is anchored to its
   * digits instead. Tested against the USER'S text, never against what chrono
   * matched, and as ONE union rather than per pack: which locale won a span says
   * nothing about which language the user wrote the time in.
   */
  const TIME_MARKER = new RegExp(
    `:${MERIDIEM === null ? "" : `|\\d\\s*${MERIDIEM}\\b`}|\\b${TIME_PREPOSITION_WORD}\\b`,
    "i",
  );

  /*
   * "the day", "a day", "in a day", "il giorno".
   *
   * chrono offers these as date candidates - "the day" out of "the day-care
   * visit" is the one that started this - and §5 rightly refuses them, because
   * a unit with no number and no direction is not a date. The refusal used to
   * be spoken, which meant an ordinary English noun drew an explanation the
   * user never asked for.
   *
   * Deliberately NARROW. It is the unit words only, with the determiners and
   * prepositions that may precede one, anchored at both ends. "the day after
   * tomorrow" keeps its warning because it carries a date word; "sat" and "mar"
   * keep theirs because they are not units, and those two warnings are the
   * whole reason D-vocab exists.
   */
  const UNIT_NOUN = required(
    oneOf([
      ...union(packs, (p) => p.offsetUnits),
      ...UNITS.flatMap((u) => union(packs, (p) => p.singularUnits[u])),
    ]),
    "offsetUnits",
  );
  const BARE_UNIT = new RegExp(`^(?:(?:${LEADING_WORDS})\\s+)*${UNIT_NOUN}$`, "iu");

  return {
    ACCEPTED_SHAPE,
    NAMES_A_MONTH,
    TIME_MARKER,
    BARE_UNIT,
    NATIVE_PHRASES: packs.flatMap((p) => p.nativePhrases),
  };
}

/* ======================================================================== */

export const UNITS: readonly Unit[] = ["day", "week", "month", "year"];

export interface RecurrenceGrammar {
  /** Shapes Vikunja cannot store. Checked BEFORE any accepted form. */
  REJECTED: RegExp[];
  /**
   * "every weekday" - approximated to weekly, and said out loud. Captures:
   * 1 = the other-word, when the phrase is "every OTHER workday".
   */
  WEEKDAY_UNIT: RegExp;
  /** "every 3 days". Captures: 1 = "!", 2 = count, 3 = unit. */
  COUNTED: RegExp;
  /**
   * "every 30 june" - a yearly repeat on a fixed calendar date. Captures:
   * 1 = "!". THE MATCH COVERS THE EVERY-WORD ONLY: the date beside it is left
   * for the date layer to read, so the repeat keeps the anchor the user typed.
   */
  YEARLY_DATE: RegExp;
  /** "every other day" - twice the interval. Captures: 1 = "!", 2 = unit. */
  OTHER: RegExp | null;
  /** "every monday". Captures: 1 = "!". */
  BARE_WEEKDAY: RegExp;
  /** "every day". Captures: 1 = "!", 2 = unit. */
  SINGULAR: RegExp;
  /** "daily". Captures: 1 = the adverb. Null when no pack has any. */
  ADVERB: RegExp | null;
  /** Which unit a captured word names, for each of the three word rules. */
  unitOf: (words: (p: LanguagePack) => UnitWords, word: string) => Unit | null;
  countedUnits: (p: LanguagePack) => UnitWords;
  singularUnits: (p: LanguagePack) => UnitWords;
  adverbs: (p: LanguagePack) => UnitWords;
}

export function compileRecurrenceGrammar(
  packs: readonly LanguagePack[],
): RecurrenceGrammar {
  const EVERY = required(group(union(packs, (p) => p.every)), "every");

  /*
   * Every weekday alternation carries `(?!\p{L})`. Without it the bare
   * alternative "mon" matched the start of "month", so `every 2 months` - an
   * accepted form - was rejected outright, and the user was told Vikunja could
   * not do something it does. The boundary belongs around the ALTERNATION, not
   * around the phrase: moving it outward is commit 6637ddd all over again.
   */
  const WD = wordBounded(weekdayRecurrenceOf(packs));

  /** Unit-major, not pack-major: "days?|giorni?|weeks?|settimane?|…". */
  const byUnit = (pick: (p: LanguagePack) => UnitWords) =>
    UNITS.flatMap((unit) => union(packs, (p) => pick(p)[unit]));

  const ORDINAL_WORDS = alternatives(union(packs, (p) => p.ordinalWords));
  const ORDINAL_SUFFIX = group(union(packs, (p) => p.ordinalSuffixes));
  const ORDINAL_TAIL = oneOf(union(packs, (p) => p.ordinalWeekdayTail));
  const LIST_SEPARATOR = required(
    // The comma is the engine's; the packs supply the word.
    group([",", ...union(packs, (p) => p.listAnd)]),
    "listAnd",
  );
  const FIRST_LAST = required(group(union(packs, (p) => p.firstLast)), "firstLast");
  const OF_THE = required(group(union(packs, (p) => p.ofThe)), "ofThe");
  const MONTH_NOUN = required(group(union(packs, (p) => p.monthNoun)), "monthNoun");
  const STARTING = oneOf(union(packs, (p) => p.startingWords));

  /*
   * A starting clause has to start a DATE.
   *
   * The rule is `every <word> … <starting-word> <tail>`, and nothing used to
   * require the tail to name a day, so "leggere ogni giorno a partire dalla
   * prima pagina" - a daily task that starts at page one - was refused as an
   * unsupported repeat, and a repeat that used to work was lost. English had
   * the same hole: "review every chapter starting from the second".
   *
   * The hint has to admit everything §5 calls a date, not just a weekday:
   * "starting next week" carries no digit, no weekday and no month. So it is
   * built from the packs' own DATE words, read from the recurrence side. It
   * scans the rest of the line rather than only the next token, because
   * "starting ON monday" and "dal 15 settembre" both put words in between.
   */
  /*
   * The WORD half of the hint carries boundaries on BOTH sides.
   *
   * Without them a month abbreviation matches inside an ordinary word: "dic"
   * sits in "de-dic-are", so "ogni settimana da dedicare al report" was read as
   * a repeat starting in December and refused. Same class as the note above
   * about "mon" matching the start of "month", and the date rule already
   * word-bounds this alternation (MONTH_NAME) - the hint was the one place
   * that did not.
   *
   * A consumed `\P{L}` rather than a lookbehind: this runs inside a lookahead,
   * so consuming one character costs nothing, and `(?<!...)` would throw on
   * construction in a Safari older than 16.4 - which for a self-hosted app is
   * a white page, not a degraded date.
   */
  const START_DATE_WORDS = alternatives([
    WD,
    ...union(packs, (p) => p.relativeDay),
    ...union(packs, (p) => p.nextPeriod),
    monthAnyOf(packs),
  ]);
  const START_DATE_HINT = alternatives([
    "\\d",
    `(?:^|\\P{L})(?:${START_DATE_WORDS})(?!\\p{L})`,
  ]);

  /*
   * Everything after the starting-word is the start date, and ALL of it has to
   * stay inside the rejected span. The tail used to be `(?:\s+WD)?` - a bare
   * weekday and nothing else - so "ogni giorno a partire dal 15 settembre"
   * warned that the repeat was unsupported and then let the date layer read
   * "15 settembre" and schedule it anyway. Warning about a phrase and then
   * acting on half of it is worse than either alone.
   *
   * A sigil is not part of the date. "#Lavoro" and "@telefono" belong to no
   * language and are extracted after this runs, so the tail stops before one
   * rather than swallowing a project the user did name.
   *
   * The leading `\S*` catches an elision: Italian writes "dall'11 settembre"
   * with no space after the apostrophe, so a tail that began with `\s+` left
   * the "11" behind for the date layer.
   */
  const START_DATE_TAIL = "\\S*(?:\\s+(?![@#*]|p[1-4]\\b)\\S+)*";
  const OTHER_WORDS = oneOf(union(packs, (p) => p.otherWords));

  /*
   * What may follow a COMPLETE schedule specification, and nothing else.
   *
   * A repeat phrase ends the scheduling part of the line. What can legitimately
   * come after it is a clock time, a sigil, or nothing. An ordinary WORD after
   * it is evidence the match was not a schedule at all:
   *
   *   "ogni 5,6 alle 15"            a day list, then a time        -> a repeat
   *   "corri ogni 1,5 km"           a decimal, then a unit noun    -> not one
   *   "standup daily at 9"          an adverb, then a time         -> a repeat
   *   "a weekly report from the vendor"  an adverb, then a noun    -> not one
   *
   * This is what separates the Italian decimal comma from a list of month days,
   * and a scheduling adverb from one describing the task's object. It is not a
   * general truth about language - it is a statement that quick-add lines put
   * the schedule last, which is how §5's shapes are written.
   */
  const TIME_PREP = required(
    oneOf(union(packs, (p) => p.timePrepositions)),
    "timePrepositions",
  );
  const NOTHING_BUT_A_TIME = `(?=\\s*$|\\s+${TIME_PREP}\\b|\\s*\\d{1,2}:\\d{2}|\\s*[@#*]|\\s+p[1-4]\\b)`;
  const MONTH_ON_THE_NTH = alternatives(union(packs, (p) => p.monthOnTheNth));

  /*
   * ORDER IS THE GRAMMAR. Every rejected shape is checked before ANY accepted
   * one, globally - never pack by pack. "every last day of month" also contains
   * the substring "month", so an accepted rule running first would match it and
   * round a calendar-shaped repeat to monthly in silence.
   */
  /*
   * A list item is a weekday or a day-of-month number: "every mon, wed",
   * "ogni 5,6". Vikunja stores one interval, so a list of ANY kind is
   * calendar-shaped and refused.
   *
   * The digits are bounded on both sides. Without the right-hand boundary
   * "ogni 15,30 alle 9" would match on "1" and "3" and report a span two
   * characters wide.
   */
  // 1 to 31, not `\d{1,2}`: "check every 0 and 1 in the output" is a pair of
  // binary values, and zero is not a day of any month.
  const DAY_OF_MONTH = "(?:3[01]|[12]\\d|[1-9])(?![\\d\\p{L}])";
  const LIST_ITEM = `(?:${WD}|${DAY_OF_MONTH})`;

  const REJECTED: RegExp[] = [
    /*
     * A list of weekdays or day numbers: "every mon, wed", "ogni 5,6".
     *
     * `NOTHING_BUT_A_TIME` is what keeps "corri ogni 1,5 km" out of it. Italian
     * writes decimals with the same comma this rule reads as a separator, and
     * no syntax distinguishes 1,5 from 5,6 - but a distance is followed by its
     * unit, and a day list is followed by a time or by nothing.
     */
    new RegExp(
      `\\b${EVERY}!?\\s+${LIST_ITEM}\\s*${LIST_SEPARATOR}\\s*${LIST_ITEM}${NOTHING_BUT_A_TIME}`,
      "iu",
    ),
  ];

  // An ordinal weekday, in digits or words: "every 2nd tuesday", "every second
  // tuesday", "every other monday". The trailing "of the month" is kept inside
  // the span so none of it survives to be re-read as a one-off date.
  if (ORDINAL_WORDS !== null) {
    REJECTED.push(
      new RegExp(
        `\\b${EVERY}!?\\s+(?:\\d+${ORDINAL_SUFFIX === null ? "" : `${ORDINAL_SUFFIX}?`}|${ORDINAL_WORDS})` +
          `\\s+${WD}${ORDINAL_TAIL === null ? "" : `(?:\\s+${ORDINAL_TAIL})?`}`,
        "iu",
      ),
    );
  }

  // "every last/first day of month"
  REJECTED.push(
    new RegExp(
      `\\b${EVERY}!?\\s+${FIRST_LAST}\\s+\\w+\\s+${OF_THE}\\s+${MONTH_NOUN}`,
      "iu",
    ),
  );

  // "every workday at 9 starting monday" - the span must reach past the
  // starting-word to the weekday, or the date matcher picks the weekday up and
  // schedules a one-off, which is what rejecting is meant to prevent.
  if (STARTING !== null) {
    REJECTED.push(
      new RegExp(
        `\\b${EVERY}!?\\s+\\w+.*?\\b${STARTING}\\b(?=.*?(?:${START_DATE_HINT}))${START_DATE_TAIL}`,
        "iu",
      ),
    );
  }

  // "every month on the 3rd" - calendar-shaped, and silently rounded to monthly
  // before this rule existed.
  if (MONTH_ON_THE_NTH !== null) {
    REJECTED.push(
      new RegExp(`\\b${EVERY}!?\\s+${MONTH_NOUN}\\s+${MONTH_ON_THE_NTH}`, "iu"),
    );
  }

  /*
   * A day number beside a month name, with no year (§5.1's "month + day" row,
   * both orders). `every 30 june 2028` names one specific year, which
   * contradicts a repeat, so the lookahead lets it fall through to the date
   * layer untouched rather than becoming a yearly task starting in 2028.
   */
  // `(?!\p{L})` as well as `(?!\d)`: "april 3rd" is an ordinal, and §5.1's
  // month + day row does not admit ordinal suffixes. Without the letter
  // boundary "every april 3rd" set a yearly repeat while the date layer went on
  // refusing "april 3rd" - a repeat with nothing to repeat from.
  const DAY_NUMBER = "\\d{1,2}(?![\\d\\p{L}])";
  const MONTH_NAME = wordBounded(monthAnyOf(packs));
  const FIXED_DATE = `(?:${DAY_NUMBER}\\s+${MONTH_NAME}|${MONTH_NAME}\\s+${DAY_NUMBER})(?!\\s+\\d{4})`;

  const WEEKDAY_UNIT_WORDS = required(
    group(union(packs, (p) => p.weekdayUnit)),
    "weekdayUnit",
  );
  /*
   * Bare, because these three sit inside a CAPTURING group: the rule reads the
   * matched unit back out to decide which interval it means. `alternatives`
   * rather than `group` keeps the capture at the index the rule expects.
   */
  const COUNTED_UNITS = required(
    alternatives(byUnit((p) => p.countedUnits)),
    "countedUnits",
  );
  const SINGULAR_UNITS = required(
    alternatives(byUnit((p) => p.singularUnits)),
    "singularUnits",
  );
  const ADVERB_WORDS = alternatives(byUnit((p) => p.adverbs));

  return {
    REJECTED,
    /*
     * The optional other-word is what keeps this rule ahead of OTHER on "ogni
     * altro giorno lavorativo". Without it OTHER matched "ogni altro giorno",
     * returned a plain two-day repeat, and left "lavorativo" in the title - a
     * word eaten and an interval invented.
     */
    WEEKDAY_UNIT: new RegExp(
      `\\b${EVERY}!?\\s+${OTHER_WORDS === null ? "" : `(${OTHER_WORDS})?\\s*`}${WEEKDAY_UNIT_WORDS}\\b`,
      "iu",
    ),
    COUNTED: new RegExp(`\\b${EVERY}(!?)\\s+(\\d{1,3})\\s+(${COUNTED_UNITS})\\b`, "iu"),
    YEARLY_DATE: new RegExp(`\\b${EVERY}(!?)(?=\\s+${FIXED_DATE})`, "iu"),
    OTHER:
      OTHER_WORDS === null
        ? null
        : /*
           * `(?![-\p{L}\p{N}])`, not `\b`: "day" in "every other day-care
           * visit" ends on a word boundary, so `\b` let the rule eat the first
           * half of a hyphenated word and leave "-care visit" in the title.
           */
          new RegExp(
            `\\b${EVERY}(!?)\\s+${OTHER_WORDS}\\s+(${SINGULAR_UNITS})(?![-\\p{L}\\p{N}])`,
            "iu",
          ),
    BARE_WEEKDAY: new RegExp(`\\b${EVERY}(!?)\\s+${WD}`, "iu"),
    SINGULAR: new RegExp(`\\b${EVERY}(!?)\\s+(${SINGULAR_UNITS})\\b`, "iu"),
    /*
     * The adverb has to END the schedule. Without that, "a weekly report from
     * the vendor" and "the medicine is taken daily by the patient" both became
     * repeating tasks: the adverb described the report and the medicine, not
     * the task. §5 lists the bare "daily" form, so requiring an every-word is
     * not available; requiring that nothing but a time follows is.
     */
    ADVERB:
      ADVERB_WORDS === null
        ? null
        : new RegExp(`\\b(${ADVERB_WORDS})\\b${NOTHING_BUT_A_TIME}`, "i"),
    unitOf: (pick, word) => {
      const needle = word.toLowerCase();
      for (const unit of UNITS) {
        for (const pack of packs) {
          if (pick(pack)[unit].some((w) => new RegExp(`^(?:${w})$`, "iu").test(needle))) {
            return unit;
          }
        }
      }
      return null;
    },
    countedUnits: (p) => p.countedUnits,
    singularUnits: (p) => p.singularUnits,
    adverbs: (p) => p.adverbs,
  };
}

/** The grammar the parser actually uses. Compiled once; the functions stay pure
 *  so a test can compile a registry of its own. */
export const DATE_GRAMMAR = compileDateGrammar(ACTIVE_PACKS);
export const RECURRENCE_GRAMMAR = compileRecurrenceGrammar(ACTIVE_PACKS);
