/*
 * Date and time phrases for quick-add (D-map-3, docs/data-model-mapping.md §5).
 *
 * Both languages are accepted because that is what the owner types: the grammar
 * table lists EN and IT forms side by side. Everything resolves in an explicit
 * IANA zone rather than the runtime's, so a task typed at 23:50 lands on the
 * day the user means.
 *
 * Nothing here guesses. A phrase that is not in the table is left in the title
 * rather than approximated into a date the user did not ask for.
 */

export interface DateMatch {
  /** Midnight of the matched day, in `timeZone`. */
  date: Date;
  /** True when the phrase itself carried a time (an ISO datetime). */
  hasTime: boolean;
  start: number;
  end: number;
  text: string;
}

export interface TimeMatch {
  hours: number;
  minutes: number;
  start: number;
  end: number;
  text: string;
  /** Puts this wall-clock time onto `day`, interpreted in `timeZone`. */
  apply(day: Date, timeZone: string): Date;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  domenica: 0,
  monday: 1,
  mon: 1,
  lunedi: 1,
  lunedì: 1,
  tuesday: 2,
  tue: 2,
  martedi: 2,
  martedì: 2,
  wednesday: 3,
  wed: 3,
  mercoledi: 3,
  mercoledì: 3,
  thursday: 4,
  thu: 4,
  giovedi: 4,
  giovedì: 4,
  friday: 5,
  fri: 5,
  venerdi: 5,
  venerdì: 5,
  saturday: 6,
  sat: 6,
  sabato: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  gen: 1,
  gennaio: 1,
  feb: 2,
  february: 2,
  febbraio: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  aprile: 4,
  may: 5,
  mag: 5,
  maggio: 5,
  jun: 6,
  june: 6,
  giu: 6,
  giugno: 6,
  jul: 7,
  july: 7,
  lug: 7,
  luglio: 7,
  aug: 8,
  august: 8,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  set: 9,
  settembre: 9,
  oct: 10,
  october: 10,
  ott: 10,
  ottobre: 10,
  nov: 11,
  november: 11,
  novembre: 11,
  dec: 12,
  december: 12,
  dic: 12,
  dicembre: 12,
};

/** Calendar parts of `instant` as seen in `timeZone`. */
function partsIn(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    f.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      String(parts.weekday),
    ),
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
  return zonedDate(year, month, day, 0, 0, timeZone);
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

function addMonths(base: Date, months: number, timeZone: string): Date {
  const p = partsIn(base, timeZone);
  const target = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return midnight(y, m, Math.min(p.day, lastDay), timeZone);
}

const named = (keys: Record<string, number>) =>
  Object.keys(keys)
    .sort((a, b) => b.length - a.length)
    .join("|");

/** Finds the first date phrase in `text`. Returns null when there is none. */
export function matchDatePhrase(
  text: string,
  now: Date,
  timeZone: string,
): DateMatch | null {
  const today = partsIn(now, timeZone);
  const todayMidnight = midnight(today.year, today.month, today.day, timeZone);

  const hit = (m: RegExpMatchArray, date: Date, hasTime = false): DateMatch => ({
    date,
    hasTime,
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: m[0],
  });

  const wd = named(WEEKDAYS);
  const mo = named(MONTHS);

  /*
   * Order matters. ISO comes first because it is the least ambiguous thing a
   * user can type, and the weekday rule comes before bare day/month so
   * "monday" is never read as a number.
   */
  const rules: { re: RegExp; run: (m: RegExpMatchArray) => DateMatch | null }[] = [
    {
      re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
      run: (m) => hit(m, midnight(Number(m[1]), Number(m[2]), Number(m[3]), timeZone)),
    },
    {
      re: /\b(today|oggi|tonight|stasera|stanotte)\b/i,
      run: (m) => hit(m, todayMidnight),
    },
    {
      re: /\b(tomorrow|domani)\b/i,
      run: (m) => hit(m, addDays(todayMidnight, 1, timeZone)),
    },
    {
      re: /\b(yesterday|ieri)\b/i,
      run: (m) => hit(m, addDays(todayMidnight, -1, timeZone)),
    },
    {
      re: /\b(?:next\s+week|settimana\s+prossima|prossima\s+settimana)\b/i,
      run: (m) => hit(m, addDays(todayMidnight, 7, timeZone)),
    },
    {
      re: /\b(?:next\s+month|mese\s+prossimo|prossimo\s+mese)\b/i,
      run: (m) => hit(m, addMonths(todayMidnight, 1, timeZone)),
    },
    {
      re: /\b(?:end\s+of\s+(?:the\s+)?month|fine\s+mese)\b/i,
      run: (m) => {
        const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
        return hit(m, midnight(today.year, today.month, lastDay, timeZone));
      },
    },
    {
      re: /\b(?:in|tra|fra)\s+(\d{1,3})\s+(days?|giorni?|weeks?|settimane?|months?|mesi|mese)\b/i,
      run: (m) => {
        const n = Number(m[1]);
        const unit = (m[2] ?? "").toLowerCase();
        if (/^(days?|giorni?)$/.test(unit))
          return hit(m, addDays(todayMidnight, n, timeZone));
        if (/^(weeks?|settimane?)$/.test(unit))
          return hit(m, addDays(todayMidnight, n * 7, timeZone));
        return hit(m, addMonths(todayMidnight, n, timeZone));
      },
    },
    {
      // Unicode boundaries, not \b: "venerdì" ends in a non-ASCII letter, so a
      // trailing \b never matches and the Italian weekdays fell through.
      re: new RegExp(
        `(?<!\\p{L})(next\\s+|prossimo\\s+|prossima\\s+)?(${wd})(\\s+prossimo|\\s+prossima)?(?!\\p{L})`,
        "iu",
      ),
      run: (m) => {
        const target = WEEKDAYS[(m[2] ?? "").toLowerCase()];
        if (target === undefined) return null;
        let delta = (target - today.weekday + 7) % 7;
        if (delta === 0) delta = 7; // "friday" on a Friday means the next one
        if (m[1] || m[3]) delta += 7;
        return hit(m, addDays(todayMidnight, delta, timeZone));
      },
    },
    {
      re: new RegExp(`\\b(\\d{1,2})\\s+(${mo})\\b`, "i"),
      run: (m) => {
        const month = MONTHS[(m[2] ?? "").toLowerCase()];
        return month ? hit(m, rollForward(Number(m[1]), month, today, timeZone)) : null;
      },
    },
    {
      re: new RegExp(`\\b(${mo})\\s+(\\d{1,2})\\b`, "i"),
      run: (m) => {
        const month = MONTHS[(m[1] ?? "").toLowerCase()];
        return month ? hit(m, rollForward(Number(m[2]), month, today, timeZone)) : null;
      },
    },
    {
      // d/m, day-first, and only when the second number can be a month.
      re: /\b(\d{1,2})\/(\d{1,2})\b/,
      run: (m) => {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (b < 1 || b > 12 || a < 1 || a > 31) return null;
        return hit(m, rollForward(a, b, today, timeZone));
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

/** A bare day+month with no year means the next time it comes round. */
function rollForward(
  day: number,
  month: number,
  today: { year: number; month: number; day: number },
  timeZone: string,
): Date {
  const thisYear = midnight(today.year, month, day, timeZone);
  const todayMidnight = midnight(today.year, today.month, today.day, timeZone);
  if (thisYear.getTime() >= todayMidnight.getTime()) return thisYear;
  return midnight(today.year + 1, month, day, timeZone);
}

/** Finds the first time phrase in `text`. */
export function matchTimePhrase(text: string): TimeMatch | null {
  const build = (
    m: RegExpMatchArray,
    hours: number,
    minutes: number,
  ): TimeMatch | null => {
    if (hours > 23 || minutes > 59) return null;
    return {
      hours,
      minutes,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      text: m[0],
      apply(day, timeZone) {
        const p = partsIn(day, timeZone);
        return zonedDate(p.year, p.month, p.day, hours, minutes, timeZone);
      },
    };
  };

  const rules: { re: RegExp; run: (m: RegExpMatchArray) => TimeMatch | null }[] = [
    {
      re: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
      run: (m) => {
        let h = Number(m[1]);
        const min = Number(m[2] ?? 0);
        const meridiem = (m[3] ?? "").toLowerCase();
        if (h < 1 || h > 12) return null;
        if (meridiem === "pm" && h !== 12) h += 12;
        if (meridiem === "am" && h === 12) h = 0;
        return build(m, h, min);
      },
    },
    // A bare clock face.
    { re: /\b(\d{1,2}):(\d{2})\b/, run: (m) => build(m, Number(m[1]), Number(m[2])) },
    // A bare number only counts with the preposition.
    {
      re: /\b(?:at|alle|alle\s+ore|ore)\s+(\d{1,2})\b/i,
      run: (m) => build(m, Number(m[1]), 0),
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
