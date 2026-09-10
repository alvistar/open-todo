/*
 * Weekday and month names shared by the quick-add layers
 * (docs/data-model-mapping.md §5).
 *
 * The two consumers deliberately admit different subsets, which is the whole
 * reason this file states them separately rather than exporting one list:
 *
 *   - Recurrence admits the English short weekdays. "every sat" can only be
 *     Saturday, because "every" has already established that a weekday follows.
 *   - The date layer does NOT. A bare "sat" is also the English past tense, and
 *     "mar" is Italian for "sea" as often as it is Tuesday, so admitting them
 *     turns "I sat down with the team" into a task due Saturday named "I down
 *     with the team". D-vocab.
 *
 * Neither admits the ITALIAN short weekdays. "ogni mar" reads as recurrence to
 * a human, but §5 does not list it and adding it is a grammar amendment rather
 * than a tidying-up, so it stays out until someone decides otherwise.
 *
 * Everything here is a regex alternation fragment rather than an array, because
 * every consumer builds a pattern out of it.
 */

/** Full weekday names. Unambiguous in both languages. */
export const WEEKDAY_FULL =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
  "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica";

/** Recurrence's vocabulary: the full names plus the English abbreviations. */
export const WEEKDAY_RECURRENCE = `${WEEKDAY_FULL}|mon|tue|wed|thu|fri|sat|sun`;

/** Full month names, both languages. */
export const MONTH_FULL =
  "january|february|march|april|may|june|july|august|september|october|november|december|" +
  "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";

/**
 * Month abbreviations. Safe for the date layer in a way the weekday ones are
 * not, because §5 only admits a month next to a day number: "30 apr" is a date,
 * a bare "apr" is not.
 */
export const MONTH_SHORT =
  "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|gen|mag|giu|lug|ago|set|ott|dic";

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
