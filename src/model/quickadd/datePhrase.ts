/*
 * Date and time phrases for quick-add (D-map-3, docs/data-model-mapping.md §5).
 *
 * D-parser: the date/time layer is chrono-node. Recurrence and the sigils stay
 * ours - chrono does not do them, and `rrule` reads Italian recurrence as
 * yearly without reporting a failure.
 *
 * Everything resolves in an explicit IANA zone rather than the runtime's, so a
 * task typed at 23:50 lands on the day the user means.
 *
 * Nothing here guesses. A phrase chrono declines is left in the title rather
 * than approximated into a date the user did not ask for.
 */

// Locale subpaths rather than the package barrel. Vite tree-shakes the barrel
// to the same bytes today (measured: identical output hash), so this is about
// stating which two of the fourteen locales we depend on, not about size.
// The two together cost 16.1 kB gzip.
import type { Chrono, ParsedResult } from "chrono-node";
import * as chronoEn from "chrono-node/en";
import * as chronoIt from "chrono-node/it";

export interface WhenMatch {
  /** Midnight of the matched day in `timeZone`, or the instant when hasTime. */
  date: Date;
  /** True when the phrase itself carried a usable clock time. */
  hasTime: boolean;
  start: number;
  end: number;
  text: string;
}

/** Calendar parts of `instant` as seen in `timeZone`. */
function partsIn(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    f.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** The offset of `timeZone` from UTC, in minutes, at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/** The instant at which `timeZone` shows the given wall-clock date and time. */
export function zonedDate(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hours, minutes, 0);
  // Two passes settle DST: the first offset may belong to the wrong side.
  let instant = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  instant = new Date(naive - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

function midnight(year: number, month: number, day: number, timeZone: string): Date {
  const atMidnight = zonedDate(year, month, day, 0, 0, timeZone);
  // Some zones skip midnight itself on their DST changeover (America/Havana,
  // Santiago, Asuncion), and 00:00 then resolves to 23:00 the previous day -
  // shifting every relative date a day early. Noon always exists, so when the
  // midnight anchor lands on the wrong calendar day, use noon instead.
  if (partsIn(atMidnight, timeZone).day === day) return atMidnight;
  return zonedDate(year, month, day, 12, 0, timeZone);
}

function addDays(base: Date, days: number, timeZone: string): Date {
  const p = partsIn(base, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return midnight(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    timeZone,
  );
}

/*
 * Phrases chrono has in neither locale. Handled here rather than as a chrono
 * custom parser because a parser only sees `refDate` as an instant: at 00:30 in
 * Rome that instant still reads as the previous month in UTC, and "end of
 * month" would resolve to the wrong month for half an hour every night.
 */
const END_OF_MONTH = /(?:\bend\s+of\s+(?:the\s+)?month\b|\bfine\s+mese\b)/i;

/*
 * A clock time only counts when the text marks one, as it did before chrono.
 * "3pm" has no word boundary before "pm", so the meridiem is anchored to its
 * digits instead.
 */
const TIME_MARKER = /:|\d\s*(?:am|pm)\b|\b(?:at|alle|ore)\b/i;

/*
 * Both locales run, because the owner types both languages in one line and
 * neither parser understands the other's words. Where they disagree the rule
 * is: earliest match wins, then the longest, then Italian.
 *
 * That last tie-break is not cosmetic. On "Apr 30" the en-GB parser returns
 * 1 April 2030 - a confident four-year error from reading "30" as a year -
 * while the Italian parser returns 30 April. Italian is also day-first, which
 * is what §5 specifies for "15/9".
 */
const PARSERS: { name: "it" | "en"; chrono: Chrono }[] = [
  { name: "it", chrono: chronoIt.casual },
  { name: "en", chrono: chronoEn.GB },
];

const PREFERENCE: Record<"it" | "en", number> = { it: 0, en: 1 };

const DATE_COMPONENTS = ["day", "month", "year", "weekday"] as const;

interface Candidate {
  name: "it" | "en";
  result: ParsedResult;
  /** Overrides the span end when the text was probed with an added year. */
  spanEnd?: number;
}

/** Finds the first date phrase in `text`. Returns null when there is none. */
export function matchWhen(text: string, now: Date, timeZone: string): WhenMatch | null {
  const today = partsIn(now, timeZone);

  const endOfMonth = END_OF_MONTH.exec(text);
  if (endOfMonth) {
    const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
    return {
      date: midnight(today.year, today.month, lastDay, timeZone),
      hasTime: false,
      start: endOfMonth.index,
      end: endOfMonth.index + endOfMonth[0].length,
      text: endOfMonth[0],
    };
  }

  const reference = { instant: now, timezone: timeZone };
  const candidates: Candidate[] = PARSERS.flatMap(({ name, chrono: parser }) =>
    parser
      .parse(text, reference, { forwardDate: true })
      .map((result) => ({ name, result })),
  ).filter(({ result }) =>
    // A time on its own is not a due date: "call at 10" leaves the text in the
    // title, exactly as it did before chrono. `isCertain` is true only for the
    // components the text actually stated, so an implied day does not count.
    DATE_COMPONENTS.some((component) => result.start.isCertain(component)),
  );

  candidates.sort((a, b) => {
    if (a.result.index !== b.result.index) return a.result.index - b.result.index;
    if (a.result.text.length !== b.result.text.length)
      return b.result.text.length - a.result.text.length;
    return PREFERENCE[a.name] - PREFERENCE[b.name];
  });

  const best = candidates[0] ?? retryWithExplicitYear(text, today.year, reference);
  if (!best) return null;

  const { result } = best;
  let instant = result.start.date();

  /*
   * A bare weekday means the next one, never today - "gym friday" typed on a
   * Friday is about the Friday to come. chrono resolves it to today, so push a
   * week. Only when chrono landed on today: "next wednesday" already resolves
   * a week out and must not be pushed twice.
   */
  if (result.start.isCertain("weekday")) {
    const resolved = partsIn(instant, timeZone);
    if (
      resolved.year === today.year &&
      resolved.month === today.month &&
      resolved.day === today.day
    ) {
      instant = addDays(instant, 7, timeZone);
    }
  }

  /*
   * chrono will read a bare number as an hour. "x 45/13 15/9" comes back as
   * 15 September at 13:00 - a time the user never typed. A clock time counts
   * only with a marker, which is the rule the hand-written matcher used.
   */
  const hasTime = result.start.isCertain("hour") && TIME_MARKER.test(result.text);

  const parts = partsIn(instant, timeZone);
  const date = hasTime
    ? zonedDate(
        parts.year,
        parts.month,
        parts.day,
        result.start.get("hour") ?? 0,
        result.start.get("minute") ?? 0,
        timeZone,
      )
    : midnight(parts.year, parts.month, parts.day, timeZone);

  const end = best.spanEnd ?? result.index + result.text.length;

  return {
    date,
    hasTime,
    start: result.index,
    end,
    text: text.slice(result.index, end),
  };
}

/*
 * chrono declines a day that does not exist in the year it infers: "29 feb"
 * read against 2026 and 2027 is simply not a date. The phrase is still one the
 * user means, so it is retried with each following year spelled out until
 * chrono accepts one - which it does only for a real date, so "30 feb" stays
 * refused. Without this the leap day vanishes from the composer with no reason
 * shown.
 */
function retryWithExplicitYear(
  text: string,
  fromYear: number,
  reference: { instant: Date; timezone: string },
): Candidate | null {
  for (let year = fromYear; year <= fromYear + 8; year += 1) {
    const suffix = ` ${year}`;
    const probe = `${text}${suffix}`;
    for (const { name, chrono: parser } of PARSERS) {
      const result = parser.parse(probe, reference, { forwardDate: true })[0];
      if (!result) continue;
      // The appended year must be part of what matched, and the phrase itself
      // must start inside the original text - otherwise the year alone matched.
      if (result.index >= text.length) continue;
      if (result.index + result.text.length !== probe.length) continue;
      return { name, result, spanEnd: text.length };
    }
  }
  return null;
}
