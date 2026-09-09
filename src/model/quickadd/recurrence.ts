/*
 * Recurrence phrases (docs/data-model-mapping.md §5).
 *
 * Vikunja models repetition as `repeat_after` seconds plus a `repeat_mode`, so
 * anything calendar-shaped - "every 2nd Tuesday", "every last day of month" -
 * has no representation. Those are REJECTED and left in the title rather than
 * approximated: silently turning "every last day of month" into "every 30 days"
 * would put the task on the wrong day for most of the year.
 */

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
  start: number;
  end: number;
  text: string;
}

const WEEKDAY =
  "monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|" +
  "luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica";

/**
 * Shapes that are clearly recurrence but that Vikunja cannot store. Checked
 * BEFORE the accepted forms, because "every last day of month" also contains
 * the substring "month".
 */
const REJECTED: RegExp[] = [
  // A list of weekdays: "every mon, wed"
  new RegExp(
    `\\b(?:every|ogni)\\s+(?:${WEEKDAY})\\s*(?:,|and|e)\\s*(?:${WEEKDAY})`,
    "iu",
  ),
  // An ordinal weekday: "every 2nd tuesday"
  new RegExp(`\\b(?:every|ogni)\\s+\\d+(?:st|nd|rd|th|°)?\\s+(?:${WEEKDAY})`, "iu"),
  // "every last/first day of month"
  /\b(?:every|ogni)\s+(?:last|first|ultimo|primo)\s+\w+\s+(?:of|del)\s+(?:month|mese)/iu,
  // "every workday at 9 starting monday"
  /\b(?:every|ogni)\s+\w+.*\bstarting\b/iu,
];

export function matchRecurrence(text: string): RecurrenceMatch | null {
  for (const pattern of REJECTED) {
    const m = text.match(pattern);
    if (m) {
      return {
        rejected: true,
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        text: m[0],
      };
    }
  }

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

  const rules: { re: RegExp; run: (m: RegExpMatchArray) => RecurrenceMatch | null }[] = [
    {
      // Approximated, and it says so out loud rather than pretending.
      re: /\b(?:every|ogni)!?\s+(?:weekday|giorno\s+feriale)\b/iu,
      run: (m) =>
        hit(m, WEEK, {
          warning: "Vikunja cannot repeat on weekdays only; saved as weekly.",
        }),
    },
    {
      re: /\b(?:every|ogni)(!?)\s+(\d{1,3})\s+(days?|giorni?|weeks?|settimane?|months?|mesi|mese|years?|anni?|anno)\b/iu,
      run: (m) => {
        const n = Number(m[2]);
        const unit = (m[3] ?? "").toLowerCase();
        if (/^(days?|giorni?)$/.test(unit)) return hit(m, n * DAY);
        if (/^(weeks?|settimane?)$/.test(unit)) return hit(m, n * WEEK);
        if (/^(months?|mesi|mese)$/.test(unit)) return hit(m, n * MONTH);
        return hit(m, n * YEAR);
      },
    },
    {
      re: new RegExp(`\\b(?:every|ogni)(!?)\\s+(?:${WEEKDAY})(?!\\p{L})`, "iu"),
      run: (m) => hit(m, WEEK),
    },
    {
      re: /\b(?:every|ogni)(!?)\s+(day|giorno|week|settimana|month|mese|year|anno)\b/iu,
      run: (m) => {
        const unit = (m[2] ?? "").toLowerCase();
        if (/^(day|giorno)$/.test(unit)) return hit(m, DAY);
        if (/^(week|settimana)$/.test(unit)) return hit(m, WEEK);
        if (/^(month|mese)$/.test(unit)) return hit(m, MONTH);
        return hit(m, YEAR);
      },
    },
    {
      re: /\b(daily|weekly|monthly|yearly|annually)\b/i,
      run: (m) => {
        const word = (m[1] ?? "").toLowerCase();
        if (word === "daily") return hit(m, DAY);
        if (word === "weekly") return hit(m, WEEK);
        if (word === "monthly") return hit(m, MONTH);
        return hit(m, YEAR);
      },
    },
  ];

  for (const rule of rules) {
    const m = text.match(rule.re);
    if (!m) continue;
    const result = rule.run(m);
    if (result) return result;
  }

  return null;
}
