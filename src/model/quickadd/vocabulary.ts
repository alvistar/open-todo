/*
 * Weekday and month names shared by the quick-add layers
 * (docs/data-model-mapping.md §5).
 *
 * The words themselves now live one per language under `lang/`, and this file
 * composes them. The exports keep the exact strings they had when they were
 * hand-written, which is what lets the extraction be checked by reading rather
 * than by trusting a test run: see `lang/packs.test.ts`.
 *
 * The two consumers deliberately admit different subsets - recurrence takes the
 * English short weekdays and the date layer does not, and neither takes the
 * Italian ones. That asymmetry is D-vocab and is documented where it is now
 * decided, in `lang/pack.ts`.
 *
 * Everything here is a regex alternation fragment rather than an array, because
 * every consumer builds a pattern out of it.
 */

import { ACTIVE_PACKS, type LanguagePack } from "./lang";

/**
 * Joins one field across every active pack.
 *
 * Returns null rather than "" when nothing is contributed. An empty alternation
 * spliced into a pattern would either leave a dangling `|` - which matches the
 * EMPTY STRING and turns a gate into something that admits everything - or a
 * `(?:)` that does the same. Callers must handle the null case explicitly, so
 * that failure cannot happen quietly.
 */
function alternation(pick: (pack: LanguagePack) => string[]): string | null {
  const words = ACTIVE_PACKS.flatMap(pick);
  return words.length === 0 ? null : words.join("|");
}

/** Present in every pack, so a missing one is a broken registry, not a choice. */
function required(value: string | null, field: string): string {
  if (value === null) {
    throw new Error(`quickadd vocabulary: no pack contributes ${field}`);
  }
  return value;
}

/** Full weekday names. Unambiguous in both languages. */
export const WEEKDAY_FULL = required(
  alternation((pack) => pack.weekdayFull),
  "weekdayFull",
);

/** Recurrence's vocabulary: the full names plus the abbreviations packs allow. */
const RECURRENCE_ABBREVIATIONS = alternation((pack) => pack.recurrenceOnlyAbbreviations);
export const WEEKDAY_RECURRENCE =
  RECURRENCE_ABBREVIATIONS === null
    ? WEEKDAY_FULL
    : `${WEEKDAY_FULL}|${RECURRENCE_ABBREVIATIONS}`;

/** Full month names, both languages. */
export const MONTH_FULL = required(
  alternation((pack) => pack.monthFull),
  "monthFull",
);

/** Month abbreviations. See `lang/pack.ts` for why a pack may omit a shared one. */
export const MONTH_SHORT = required(
  alternation((pack) => pack.monthShort),
  "monthShort",
);

/** Every month form. */
export const MONTH_ANY = `${MONTH_FULL}|${MONTH_SHORT}`;

/**
 * Closes an alternation against a longer word. Without it the alternative
 * "mon" matches the start of "month", and `every 2 months` — an accepted
 * recurrence — was rejected as a weekday list.
 */
export function wordBounded(alternation: string): string {
  return `(?:${alternation})(?!\\p{L})`;
}
