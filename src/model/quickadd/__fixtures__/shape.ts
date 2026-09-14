/*
 * The shape a golden record records, and the context it was produced under.
 *
 * Imported by BOTH `scripts/quickadd-golden.mjs` (which writes the fixture) and
 * `corpus.golden.test.ts` (which replays it). One definition on purpose: if the
 * generator and the replay shaped their answers separately, a drift between the
 * two would read as a behaviour change and send someone hunting a bug in the
 * parser that lives in the harness.
 */

import type { QuickAddContext, QuickAddResult } from "../parse";

const DAY = 86_400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** What the fixture stores for one phrase. */
export interface GoldenAnswer {
  kind: "date" | "datetime" | "recurrence" | "none";
  /** The union of the date and time spans, in the user's text. */
  span: { start: number; end: number; text: string } | null;
  /** Wall clock in `tz`: YYYY-MM-DD when all-day, else YYYY-MM-DDTHH:MM. */
  value: string | null;
  allDay: boolean;
  recurrence: { freq: string; interval: number; fromCompletion: boolean } | null;
  warnings: string[];
  title: string;
}

export interface GoldenRecord {
  id: string;
  input: string;
  /** ISO instant with offset. Each source pins its own clock. */
  now: string;
  lang: string;
  tz: string;
  ours: GoldenAnswer;
}

/**
 * Fixed, so a record replays identically. Matches the context the corpus lab
 * uses, which is why the fixture's answers line up with a lab run.
 */
export function goldenContext(now: Date, timeZone: string): QuickAddContext {
  return {
    now,
    timeZone,
    defaultDueTime: null,
    defaultProjectId: null,
    projects: [
      { id: 1, title: "project" },
      { id: 2, title: "Casa e giardino" },
      { id: 3, title: "Work" },
      { id: 4, title: "Lunedi" },
    ],
    labels: [
      { id: 1, title: "label" },
      { id: 10, title: "phone" },
      { id: 11, title: "urgent" },
    ],
  };
}

/** Largest unit that divides evenly, so 14 days reads as 2 weeks. */
function asRecurrence(repeatAfter?: number, repeatMode?: number) {
  if (!repeatAfter) return null;
  const units: [number, string][] = [
    [YEAR, "yearly"],
    [MONTH, "monthly"],
    [WEEK, "weekly"],
    [DAY, "daily"],
  ];
  for (const [seconds, freq] of units) {
    if (repeatAfter % seconds === 0) {
      return { freq, interval: repeatAfter / seconds, fromCompletion: repeatMode === 2 };
    }
  }
  return { freq: "custom", interval: repeatAfter, fromCompletion: repeatMode === 2 };
}

function wallClock(instant: Date, timeZone: string, dateOnly: boolean): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  if (dateOnly) return date;
  return `${date}T${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

/** The smallest range covering every date/time span, or null. */
function unionSpan(result: QuickAddResult, input: string) {
  const relevant = result.spans.filter((s) => s.kind === "date" || s.kind === "time");
  if (relevant.length === 0) return null;
  const start = Math.min(...relevant.map((s) => s.start));
  const end = Math.max(...relevant.map((s) => s.end));
  return { start, end, text: input.slice(start, end) };
}

export function shape(
  result: QuickAddResult,
  input: string,
  timeZone: string,
): GoldenAnswer {
  const recurrence = asRecurrence(result.repeatAfter, result.repeatMode);
  const span = unionSpan(result, input);
  const base = { span, warnings: result.warnings, title: result.title };

  if (recurrence) {
    return {
      ...base,
      kind: "recurrence",
      value: result.dueDate ? wallClock(result.dueDate, timeZone, result.allDay) : null,
      allDay: result.allDay,
      recurrence,
    };
  }
  if (!result.dueDate) {
    return {
      ...base,
      kind: "none",
      span: null,
      value: null,
      allDay: false,
      recurrence: null,
    };
  }
  return {
    ...base,
    kind: result.allDay ? "date" : "datetime",
    value: wallClock(result.dueDate, timeZone, result.allDay),
    allDay: result.allDay,
    recurrence: null,
  };
}
