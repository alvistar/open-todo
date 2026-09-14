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
export interface LanguagePack {
  /** Stable id, for diagnostics and test names. Never shown to a user. */
  code: string;

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

  /**
   * Phrases in THIS language that must NOT become a date.
   *
   * They ship with the pack because the §5 gate is language-BLIND: every pack's
   * words are admitted for all text, in every language, so adding a pack widens
   * the gate for every other language too. French "mai" is the Italian for
   * "never"; the day an fr pack lands, "non lo faccio mai" acquires a due date,
   * and nothing in the fr pack read on its own would show it.
   *
   * The test runs every pack's list through the WHOLE registry, which is the
   * only version of "one new file" that is safe.
   */
  negativeCorpus: string[];
}
