/*
 * Recurrence phrases (docs/data-model-mapping.md §5).
 *
 * Vikunja models repetition as `repeat_after` seconds plus a `repeat_mode`, so
 * anything calendar-shaped - "every 2nd Tuesday", "every last day of month" -
 * has no representation. Those are REJECTED and left in the title rather than
 * approximated: silently turning "every last day of month" into "every 30 days"
 * would put the task on the wrong day for most of the year.
 */

import {
  compileRecurrenceGrammar,
  RECURRENCE_GRAMMAR,
  type RecurrenceGrammar,
} from "./grammar";
import type { LanguagePack, Unit } from "./lang/pack";

export const DAY = 24 * 60 * 60;
export const WEEK = 7 * DAY;
/** Vikunja's own month/year approximations, matching its UI. */
export const MONTH = 30 * DAY;
export const YEAR = 365 * DAY;

export interface RecurrenceMatch {
  repeatAfter?: number;
  /** 0 = after the last due date, 2 = from the completion date. */
  repeatMode?: number;
  /** Set when the phrase is understood but only approximately. */
  warning?: string;
  /** Set when the phrase is recognised as recurrence Vikunja cannot express. */
  rejected?: boolean;
  /**
   * Set when the repeat is meaningless on its own, because the phrase named the
   * day it repeats ON rather than an interval. "every 30 june" is a year
   * counted FROM 30 June; if the date layer then refuses "30 june" - because it
   * carries an ordinal, or a year, or names a day that does not exist - the
   * repeat has nothing to repeat from and must go with it.
   */
  needsDate?: boolean;
  start: number;
  end: number;
  text: string;
}

/** Seconds per repeat unit, as Vikunja's UI counts them. */
const SECONDS: Record<Unit, number> = { day: DAY, week: WEEK, month: MONTH, year: YEAR };

export function matchRecurrence(text: string): RecurrenceMatch | null {
  return matchRecurrenceIn(RECURRENCE_GRAMMAR, text);
}

/** The same, against a registry of your choosing. See `matchWhenWith`. */
export function matchRecurrenceWith(
  packs: readonly LanguagePack[],
  text: string,
): RecurrenceMatch | null {
  return matchRecurrenceIn(compileRecurrenceGrammar(packs), text);
}

function matchRecurrenceIn(g: RecurrenceGrammar, text: string): RecurrenceMatch | null {
  /*
   * Rejected shapes first, ALL of them, before any accepted one. The ordering is
   * global rather than per language: "every last day of month" also contains the
   * substring "month", so an accepted rule running first would match it and
   * round a calendar-shaped repeat to monthly in silence.
   */
  /*
   * ALL of them, then the WIDEST match - not the first one that hits.
   *
   * Array order is arbitrary here, and two rejected shapes can both match one
   * line: "pay every 5,6 starting monday" is a day-number list AND a starting
   * clause. Returning the first match masked only "every 5,6", and the date
   * layer then read "starting monday" and scheduled it. Whatever a rejection
   * leaves behind is re-read by the next layer, so the rejection has to take
   * the most text, not the earliest.
   *
   * Leftmost breaks a tie on width, so the span still starts where the user's
   * unsupported phrase starts.
   */
  let widest: RecurrenceMatch | null = null;
  for (const pattern of g.REJECTED) {
    const m = text.match(pattern);
    if (!m) continue;
    const start = m.index ?? 0;
    const candidate: RecurrenceMatch = {
      rejected: true,
      start,
      end: start + m[0].length,
      text: m[0],
    };
    if (
      widest === null ||
      candidate.end - candidate.start > widest.end - widest.start ||
      (candidate.end - candidate.start === widest.end - widest.start &&
        candidate.start < widest.start)
    ) {
      widest = candidate;
    }
  }
  if (widest) return widest;

  const hit = (
    m: RegExpMatchArray,
    repeatAfter: number,
    extra: Partial<RecurrenceMatch> = {},
  ): RecurrenceMatch => ({
    repeatAfter,
    // "every!" repeats from the completion date instead of the last due date.
    repeatMode: m[0].includes("!") ? 2 : 0,
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: m[0],
    ...extra,
  });

  /*
   * Each unit rule reads its captured word back through `unitOf` rather than
   * re-testing it against a hand-written alternation. The old form had the unit
   * list written twice - once in the pattern, once in the dispatch - kept in
   * step by hand, with an unconditional final `return hit(m, n * YEAR)` standing
   * in for "must be years". Returning null instead means a unit the pattern
   * admits but the dispatch does not recognise fails loudly rather than becoming
   * an annual repeat.
   */
  const byUnit = (
    m: RegExpMatchArray,
    word: string,
    words: Parameters<typeof g.unitOf>[0],
    multiplier: number,
  ): RecurrenceMatch | null => {
    const unit = g.unitOf(words, word);
    return unit === null ? null : hit(m, multiplier * SECONDS[unit]);
  };

  const rules: {
    re: RegExp | null;
    run: (m: RegExpMatchArray) => RecurrenceMatch | null;
  }[] = [
    {
      // Approximated, and it says so out loud rather than pretending.
      re: g.WEEKDAY_UNIT,
      run: (m) =>
        m[1]
          ? hit(m, 2 * WEEK, {
              warning: "Vikunja cannot repeat on weekdays only; saved as every 2 weeks.",
            })
          : hit(m, WEEK, {
              warning: "Vikunja cannot repeat on weekdays only; saved as weekly.",
            }),
    },
    {
      re: g.COUNTED,
      run: (m) => byUnit(m, m[3] ?? "", g.countedUnits, Number(m[2])),
    },
    {
      /*
       * "every other day" is "every 2 days", which Vikunja stores exactly.
       * §5.1 never listed it as rejected; it was simply not in the grammar, and
       * fell through both lists in silence.
       *
       * Before SINGULAR, which would otherwise be reached with the other-word
       * still in the text, and before BARE_WEEKDAY for the same reason the
       * yearly rule is: shapes with more words in them go first.
       */
      re: g.OTHER,
      run: (m) => byUnit(m, m[2] ?? "", g.singularUnits, 2),
    },
    {
      /*
       * "ogni 30 giugno" - yearly on a fixed calendar date.
       *
       * Two things make this rule unlike every other one here. Its span covers
       * the every-word ONLY, so "30 giugno" survives for the date layer and the
       * repeat keeps the anchor the user typed; every other accepted rule
       * swallows its whole phrase and leaves no due date at all. And it must run
       * BEFORE BARE_WEEKDAY: no shipping pack has a token that is both a month
       * abbreviation and a weekday one, but Italian "mar" is exactly that, and
       * the day it is added to `recurrenceOnlyAbbreviations` "ogni mar 5" has to
       * stay 5 March rather than becoming every Tuesday.
       *
       * 365 days is Vikunja's own year, the same approximation "every year"
       * already makes, so it is silent for the same reason. It drifts a day
       * earlier after each leap year - early, never late.
       */
      re: g.YEARLY_DATE,
      run: (m) => hit(m, YEAR, { needsDate: true }),
    },
    {
      re: g.BARE_WEEKDAY,
      run: (m) => hit(m, WEEK),
    },
    {
      re: g.SINGULAR,
      run: (m) => byUnit(m, m[2] ?? "", g.singularUnits, 1),
    },
    {
      re: g.ADVERB,
      run: (m) => byUnit(m, m[1] ?? "", g.adverbs, 1),
    },
  ];

  for (const rule of rules) {
    // A rule whose pattern no active pack feeds is absent, not empty.
    if (rule.re === null) continue;
    const m = text.match(rule.re);
    if (!m) continue;
    const result = rule.run(m);
    if (result) return result;
  }

  return null;
}
