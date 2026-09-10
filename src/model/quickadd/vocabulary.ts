/*
 * Weekday and month names shared by the quick-add layers
 * (docs/data-model-mapping.md §5).
 *
 * The two consumers deliberately admit different subsets, which is the whole
 * reason this file states them separately rather than exporting one list:
 *
 *   - Recurrence admits the short weekdays. "every sat" can only be Saturday,
 *     because "every" has already established that a weekday follows.
 *   - The date layer does NOT. A bare "sat" is also the English past tense, and
 *     "mar" is Italian for "sea" as often as it is Tuesday, so admitting them
 *     turns "I sat down with the team" into a task due Saturday named "I down
 *     with the team". D-vocab.
 *
 * Everything here is a regex alternation fragment rather than an array, because
 * every consumer builds a pattern out of it.
 */

/** Full weekday names. Unambiguous in both languages. */
export const WEEKDAY_FULL =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
  "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica";

/**
 * Three-letter weekday abbreviations. Recurrence only — see the note above.
 * Italian "mar" and "dom" and English "sat", "mon", "sun", "wed" are all
 * ordinary words in one language or the other.
 */
export const WEEKDAY_SHORT = "mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|gio|ven|sab|dom";

/** Every weekday form. Recurrence's vocabulary. */
export const WEEKDAY_ANY = `${WEEKDAY_FULL}|${WEEKDAY_SHORT}`;

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
  "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|" + "gen|mag|giu|lug|ago|set|ott|dic";

/** Every month form. */
export const MONTH_ANY = `${MONTH_FULL}|${MONTH_SHORT}`;

/**
 * Closes an alternation against a longer word. Without it the alternative
 * "mon" matches the start of "month", and `every 2 months` — an accepted
 * recurrence — was rejected as a weekday list.
 */
export function word(alternation: string): string {
  return `(?:${alternation})(?!\\p{L})`;
}
