import { type LanguagePack, lastDayOfMonth } from "./pack";

export const it: LanguagePack = {
  code: "it",

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
