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
import { compileDateGrammar, DATE_GRAMMAR, type DateGrammar } from "./grammar";
import { ACTIVE_PACKS } from "./lang";
import type { LanguagePack } from "./lang/pack";

export interface WhenMatch {
  /** Midnight of the matched day in `timeZone`, or the instant when hasTime. */
  date: Date;
  /** True when the phrase itself carried a usable clock time. */
  hasTime: boolean;
  start: number;
  end: number;
  text: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * A span the date layer recognised but §5 does not admit. Reported rather than
 * dropped: the text stays in the title, and the composer says why.
 */
export interface RejectedSpan {
  start: number;
  end: number;
  text: string;
  /**
   * chrono's instant idioms - "now", "a sec", "in a minute". Real matches, but
   * nobody typing them believes they are setting a due date, and warning on
   * them would train the user to ignore the warning that protects "sat".
   */
  silent: boolean;
}

export interface WhenResult {
  when: WhenMatch | null;
  /** In text order, de-duplicated. Never overlaps `when`. */
  rejected: RejectedSpan[];
}

/** Calendar parts of `instant` as seen in `timeZone`. */
function partsIn(instant: Date, timeZone: string): DateParts {
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

/** Sigil masking leaves multi-space gaps: "domani       alle 10" is one span. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isBefore(a: DateParts, b: DateParts): boolean {
  return a.year * 10000 + a.month * 100 + a.day < b.year * 10000 + b.month * 100 + b.day;
}

/*
 * chrono is certain of an hour, names no weekday, and the text holds no digit.
 * That is the shape of "now", "a sec", "a second", "in a minute" - and of
 * nothing that needs protecting: "sat at 10" names a weekday, "March" has no
 * hour, "in 2 hours" has a digit.
 *
 * Note there is no `!isCertain("month")` here, tempting as it reads. chrono
 * marks day, month AND year certain on all four of these, so that clause would
 * make the predicate never fire.
 */
function isInstantIdiom(result: ParsedResult, spanText: string): boolean {
  return (
    result.start.isCertain("hour") &&
    !result.start.isCertain("weekday") &&
    !/\d/.test(spanText)
  );
}

interface Offsets {
  start: number;
  end: number;
}

function overlaps(a: Offsets, b: Offsets): boolean {
  return a.start < b.end && b.start < a.end;
}

/*
 * Both locales parse the same line, so one phrase can be rejected twice: "this
 * weekend" is [5,12) "weekend" in Italian and [0,14) "this weekend" in English.
 * And a span can be rejected by one locale while ACCEPTED by the other - "Apr
 * 30" is a real date to the Italian parser and a bare month+year to the English
 * one - which must not produce a warning on a phrase that set a date.
 *
 * So: an accepted span silences anything it overlaps, and what is left collapses
 * to the longest, matching the earliest-then-longest preference used for the
 * winner.
 */
function collapse(rejected: RejectedSpan[], accepted: Offsets[]): RejectedSpan[] {
  const kept: RejectedSpan[] = [];
  const byPreference = [...rejected].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  for (const span of byPreference) {
    if (accepted.some((a) => overlaps(a, span))) continue;
    if (kept.some((k) => overlaps(k, span))) continue;
    kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Whether a candidate is one of the §5 shapes. Applied to every candidate
 * BEFORE the earliest-wins sort, never only to the winner: a rejected early
 * false positive must not hide a valid date later in the line, so that
 * "I sat with the team tomorrow" still resolves to tomorrow.
 */
function isAdmissible(
  DATE_GRAMMAR: DateGrammar,
  result: ParsedResult,
  spanText: string,
  today: DateParts,
  timeZone: string,
): boolean {
  // A range. chrono collapses "Friday to Monday" to its start, silently
  // discarding the half the user typed.
  if (result.end) return false;

  const norm = normalise(spanText);
  if (!DATE_GRAMMAR.ACCEPTED_SHAPE.test(norm)) return false;

  // chrono reads a trailing number after a month as a YEAR: "feb 29" comes
  // back as 1 February 2029 and "Sep 15" as 1 September 2015, both with the
  // day merely implied. Both pass the shape test on text alone.
  if (DATE_GRAMMAR.NAMES_A_MONTH.test(norm) && !result.start.isCertain("day"))
    return false;

  // A due date in the past is not a task. This is also what refuses
  // "yesterday" / "ieri", so they need no special case.
  return !isBefore(partsIn(result.start.date(), timeZone), today);
}

/*
 * Both locales run, because the owner types both languages in one line and
 * neither parser understands the other's words. "next venerdì" and "prossimo
 * friday" both resolve today, because the §5 shapes are bilingual rather than
 * per-language.
 *
 * Where two candidates collide the rule is: earliest match wins, then the
 * longest, then registry order. That last tie-break only breaks exact ties -
 * it is NOT what settles "Apr 30". The en-GB parser does return 1 April 2030
 * there, but with `day` uncertain, so `isAdmissible` drops it before the sort
 * runs. "15/9" is day-first in en-GB as well as in Italian.
 */
type Resolvers = { name: string; chrono: Chrono; preference: number }[];

const resolversOf = (packs: readonly LanguagePack[]): Resolvers =>
  packs.map((pack) => ({
    name: pack.code,
    chrono: pack.resolver,
    preference: pack.preference,
  }));

const PARSERS = resolversOf(ACTIVE_PACKS);

const DATE_COMPONENTS = ["day", "month", "year", "weekday"] as const;

interface Candidate {
  name: string;
  preference: number;
  result: ParsedResult;
  /**
   * The span in the USER's text.
   *
   * `matchWhen` parses the user's text directly, so these are chrono's own
   * indices. `retryWithExplicitYear` is the one path that parses something else:
   * it appends a year AFTER the window, which keeps every offset aligned, and it
   * returns spans in original coordinates itself. Nothing here may assume a
   * probe exists, and nothing should reintroduce one without a map.
   */
  start: number;
  end: number;
}

/**
 * Finds the first admissible date phrase in `text`, plus every span the gate
 * turned down. Both, not one or the other: "I sat with the team tomorrow" owes
 * the user a due date AND an explanation of what happened to "sat".
 */
export function matchWhen(text: string, now: Date, timeZone: string): WhenResult {
  return matchWhenIn(DATE_GRAMMAR, PARSERS, text, now, timeZone);
}

/**
 * The same, against a registry of your choosing.
 *
 * The acceptance test for the whole pack design drives this: proving a new pack
 * COMPILES says nothing about whether it reaches resolution, the §5 gate, span
 * collapsing or the leap-day retry. Not for production use - the module
 * constants are compiled once, this recompiles per call.
 */
export function matchWhenWith(
  packs: readonly LanguagePack[],
  text: string,
  now: Date,
  timeZone: string,
): WhenResult {
  return matchWhenIn(compileDateGrammar(packs), resolversOf(packs), text, now, timeZone);
}

function matchWhenIn(
  DATE_GRAMMAR: DateGrammar,
  PARSERS: Resolvers,
  text: string,
  now: Date,
  timeZone: string,
): WhenResult {
  const today = partsIn(now, timeZone);

  /*
   * Phrases chrono has in no locale, resolved before it runs. They resolve in
   * CALENDAR terms in the user's zone: a chrono custom parser sees `refDate`
   * only as an instant, and at 00:30 in Rome that instant is still the previous
   * month in UTC, so "end of month" would name the wrong month every night.
   *
   * The LEFTMOST match across every pack wins, which is what a single combined
   * regex used to do for free. Returning on the first pack that matched would
   * make registry order decide "end of month fine mese", picking the later
   * phrase and cutting the wrong words out of the title.
   */
  const native = DATE_GRAMMAR.NATIVE_PHRASES.map((phrase) => ({
    phrase,
    match: phrase.pattern.exec(text),
  }))
    .filter((candidate) => candidate.match !== null)
    .sort(
      (a, b) => (a.match as RegExpExecArray).index - (b.match as RegExpExecArray).index,
    )[0];

  if (native) {
    const match = native.match as RegExpExecArray;
    const resolved = native.phrase.resolve(today);
    return {
      when: {
        date: midnight(resolved.year, resolved.month, resolved.day, timeZone),
        hasTime: false,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      },
      // The one path where the gate never runs, so nothing was turned down.
      rejected: [],
    };
  }

  const reference = { instant: now, timezone: timeZone };
  const candidates: Candidate[] = PARSERS.flatMap(
    ({ name, preference, chrono: parser }) =>
      parser.parse(text, reference, { forwardDate: true }).map((result) => ({
        name,
        preference,
        result,
        start: result.index,
        end: result.index + result.text.length,
      })),
  ).filter(({ result }) =>
    // A time on its own is not a due date: "call at 10" leaves the text in the
    // title, exactly as it did before chrono. `isCertain` is true only for the
    // components the text actually stated, so an implied day does not count.
    DATE_COMPONENTS.some((component) => result.start.isCertain(component)),
  );

  const admissible: Candidate[] = [];
  const turnedDown: RejectedSpan[] = [];
  for (const candidate of candidates) {
    const { result, start, end } = candidate;
    // Always the user's own words. Sigil masking can leave a span whose text
    // differs from what chrono matched, and `retryWithExplicitYear` parses a
    // probe of its own, so the gate reads the source text every time.
    const spanText = text.slice(start, end);
    if (isAdmissible(DATE_GRAMMAR, result, spanText, today, timeZone)) {
      admissible.push(candidate);
      continue;
    }
    turnedDown.push({
      start,
      end,
      text: spanText,
      silent: isInstantIdiom(result, spanText),
    });
  }

  admissible.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end - a.start !== b.end - b.start) return b.end - b.start - (a.end - a.start);
    return a.preference - b.preference;
  });

  /*
   * The retry runs only when chrono found nothing at all, never when the gate
   * rejected what it found: appending a year to "sat" would otherwise be a way
   * around the gate rather than a rescue for a leap day.
   */
  const best =
    admissible[0] ??
    (candidates.length === 0
      ? retryWithExplicitYear(
          PARSERS,
          DATE_GRAMMAR,
          text,
          today.year,
          reference,
          today,
          timeZone,
        )
      : null);

  const accepted = admissible.map(({ start, end }) => ({ start, end }));
  const rejected = collapse(turnedDown, accepted);

  if (!best) return { when: null, rejected };

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
  // Tested against the user's text, not against what chrono matched: it is the
  // word the user typed that decides whether they named a time.
  const hasTime =
    result.start.isCertain("hour") &&
    DATE_GRAMMAR.TIME_MARKER.test(text.slice(best.start, best.end));

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

  return {
    when: {
      date,
      hasTime,
      start: best.start,
      end: best.end,
      text: text.slice(best.start, best.end),
    },
    rejected,
  };
}

/*
 * chrono declines a day that does not exist in the year it infers: "29 feb"
 * read against 2026 and 2027 is simply not a date. The phrase is still one the
 * user means, so it is retried with each following year spelled out until
 * chrono accepts one - which it does only for a real date, so "30 feb" stays
 * refused. Without this the leap day vanishes from the composer with no reason
 * shown.
 *
 * The year is inserted after the window rather than appended to the whole line,
 * because appending required the match to reach the end of the string: "party
 * 29 feb" resolved while "29 feb party" and "party 29 feb please" returned
 * nothing at all. Inserting in place also keeps every offset aligned with the
 * original text, so the span needs no translating back.
 */
function retryWithExplicitYear(
  PARSERS: Resolvers,
  DATE_GRAMMAR: DateGrammar,
  text: string,
  fromYear: number,
  reference: { instant: Date; timezone: string },
  today: DateParts,
  timeZone: string,
): Candidate | null {
  for (const [start, end] of monthWindows(DATE_GRAMMAR, text)) {
    for (let year = fromYear; year <= fromYear + 8; year += 1) {
      const suffix = ` ${year}`;
      const probe = text.slice(0, end) + suffix + text.slice(end);
      for (const { name, preference, chrono: parser } of PARSERS) {
        const result = parser.parse(probe, reference, { forwardDate: true })[0];
        if (!result) continue;
        // The match must start inside the window and run through the year we
        // inserted - otherwise the year matched on its own.
        if (result.index < start || result.index >= end) continue;
        if (result.index + result.text.length !== end + suffix.length) continue;
        // The gate must see the user's text, not the probe: result.text here
        // reads "29 feb 2028", a year the user never typed.
        if (
          !isAdmissible(
            DATE_GRAMMAR,
            result,
            text.slice(result.index, end),
            today,
            timeZone,
          )
        ) {
          continue;
        }
        // The probe only inserts text AFTER the window, so an index inside it
        // already means the same position in the user's text.
        return { name, preference, result, start: result.index, end };
      }
    }
  }
  return null;
}

/**
 * Token windows worth probing: at most three words, holding both a digit and a
 * month name. The month is what keeps this off the per-keystroke path - windows
 * chosen on a digit alone would put "buy 3 apples" through about a hundred
 * chrono parses per keystroke, for a phrase that is not a date in any year.
 */
function monthWindows(DATE_GRAMMAR: DateGrammar, text: string): [number, number][] {
  const tokens = [...text.matchAll(/\S+/g)].map(
    (m) => [m.index, m.index + m[0].length] as [number, number],
  );
  const windows: [number, number][] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let size = 1; size <= 3 && i + size <= tokens.length; size += 1) {
      const start = tokens[i]?.[0] ?? 0;
      const end = tokens[i + size - 1]?.[1] ?? 0;
      const span = text.slice(start, end);
      if (!/\d/.test(span)) continue;
      if (!DATE_GRAMMAR.NAMES_A_MONTH.test(span)) continue;
      windows.push([start, end]);
    }
  }
  return windows;
}
