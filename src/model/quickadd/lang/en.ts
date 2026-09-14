import type { LanguagePack } from "./pack";

export const en: LanguagePack = {
  code: "en",

  weekdayFull: [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ],

  // "every sat" can only be Saturday. A bare "sat" is the past tense, which is
  // why the date layer never sees this list. See pack.ts.
  recurrenceOnlyAbbreviations: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],

  monthFull: [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ],

  // No "may": the full name is already an abbreviation of itself.
  // "feb", "mar", "apr" and "nov" are carried here for Italian too - see pack.ts.
  monthShort: [
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
  ],

  negativeCorpus: [
    // The two that made the case for D-vocab in the first place.
    "I sat down with the team",
    "call next mon",
    // "weekend" is English, and Italian text has to survive it too.
    "weekend plans",
    "this weekend",
    // A bare month name is a period, not a date.
    "March report",
    // Digits that are not a date.
    "buy 3 apples",
  ],
};
