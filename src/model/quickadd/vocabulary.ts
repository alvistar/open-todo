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

import {
  monthAnyOf,
  monthFullOf,
  monthShortOf,
  weekdayFullOf,
  weekdayRecurrenceOf,
  wordBounded,
} from "./grammar";
import { ACTIVE_PACKS } from "./lang";

/*
 * The composition itself lives in grammar.ts, PARAMETERISED by a pack list.
 * These are that composition applied to the shipping registry, and nothing more.
 * Keeping them here, with the names and the exact strings they always had, is
 * what lets scripts/quickadd-corpus-diff.mjs check out an older datePhrase.ts
 * against the current tree.
 */

/** Full weekday names. Unambiguous in both languages. */
export const WEEKDAY_FULL = weekdayFullOf(ACTIVE_PACKS);

/** Recurrence's vocabulary: the full names plus the abbreviations packs allow. */
export const WEEKDAY_RECURRENCE = weekdayRecurrenceOf(ACTIVE_PACKS);

/** Full month names, both languages. */
export const MONTH_FULL = monthFullOf(ACTIVE_PACKS);

/** Month abbreviations. See `lang/pack.ts` for why a pack may omit a shared one. */
export const MONTH_SHORT = monthShortOf(ACTIVE_PACKS);

/** Every month form. */
export const MONTH_ANY = monthAnyOf(ACTIVE_PACKS);

export { wordBounded };
