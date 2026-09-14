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
import type { LanguagePack, NativePhrase } from "./lang/pack";
import { MONTH_ANY, WEEKDAY_FULL, wordBounded } from "./vocabulary";

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
}

export function compileDateGrammar(packs: readonly LanguagePack[]): DateGrammar {
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

  return {
    ACCEPTED_SHAPE,
    NAMES_A_MONTH,
    TIME_MARKER,
    NATIVE_PHRASES: packs.flatMap((p) => p.nativePhrases),
  };
}

/** The grammar the parser actually uses. Compiled once; the function stays pure
 *  so a test can compile a registry of its own. */
export const DATE_GRAMMAR = compileDateGrammar(ACTIVE_PACKS);
