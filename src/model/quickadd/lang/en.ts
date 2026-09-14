import * as chronoEn from "chrono-node/en";
import { type LanguagePack, lastDayOfMonth } from "./pack";

export const en: LanguagePack = {
  code: "en",

  preference: 1,
  /*
   * GB, not `casual`. It is day-first, which is what §5 specifies for "15/9" -
   * and it is the reason that reading does NOT depend on the Italian parser
   * winning a tie, contrary to what the old comment on PREFERENCE claimed.
   */
  resolver: chronoEn.GB,

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

  relativeDay: ["today", "tomorrow", "tonight"],

  dayPart: ["morning", "afternoon", "evening", "night"],

  weekdayPrefixes: ["next"],
  // "friday next" is not English.
  weekdayPostfixes: [],

  offsetPrepositions: ["in"],
  // §5 lists "in 3 days" but never "in a month", so no word forms here.
  offsetWordNumbers: [],
  offsetUnits: ["days?", "weeks?", "months?"],

  nextPeriod: ["next\\s+(?:week|month)"],

  timePrepositions: ["at"],
  timePrepositionSuffixes: [],

  meridiem: ["am", "pm"],

  every: ["every"],
  listAnd: ["and"],
  ordinalWords: ["second", "third", "fourth", "fifth", "last", "first", "other", "next"],
  ordinalSuffixes: ["st", "nd", "rd", "th"],
  ordinalWeekdayTail: ["of\\s+(?:the\\s+)?month"],
  firstLast: ["last", "first"],
  ofThe: ["of"],
  monthNoun: ["month"],
  startingWords: ["starting"],
  monthOnTheNth: ["on\\s+the\\s+\\d+(?:st|nd|rd|th)?"],
  // "workday" and "working day" mean the same thing to a user and took the
  // same approximation warning; only "weekday" was in the grammar.
  weekdayUnit: ["weekdays?", "work\\s*days?", "working\\s+days?"],
  otherWords: ["other"],
  countedUnits: {
    day: ["days?"],
    week: ["weeks?"],
    month: ["months?"],
    year: ["years?"],
  },
  singularUnits: { day: ["day"], week: ["week"], month: ["month"], year: ["year"] },
  adverbs: {
    day: ["daily"],
    week: ["weekly"],
    month: ["monthly"],
    year: ["yearly", "annually"],
  },

  nativePhrases: [
    { pattern: /\bend\s+of\s+(?:the\s+)?month\b/i, resolve: lastDayOfMonth },
  ],

  /*
   * "every" and "other" as quantifiers, units that are the head of a longer
   * word, and the repeat adverbs describing the task's OBJECT rather than the
   * task. Each one was checked to be inert; the ones that are NOT are pinned in
   * known-defects.test.ts instead of being quietly dropped from this list.
   */
  inertCorpus: [
    "review every invoice before paying",
    "answer every customer email",
    "check every line of the report",
    "thank every attendee",
    "every single one of them is wrong",
    "every other option was worse",
    "order a new set of keys",
    "read the second chapter",
    "bring snacks to every other day-care visit",
    "check every 0 and 1 in the output",
    "review every chapter starting from the second",
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
