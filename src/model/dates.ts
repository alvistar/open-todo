import { VIKUNJA_NULL_DATE } from "../api/types";
import type { ScheduleKind } from "./display";

/**
 * D-map-2 (docs/data-model-mapping.md §2 and §6 item 1).
 *
 * Vikunja has no all-day flag: a due date is always a datetime. The convention
 * shared with Veyrn is that a date without a time is stored at the user's
 * `default_due_time` (a 2.6+ setting) and shown date-only when the time matches
 * it. On an older server, or when the setting is unset, the fallback is 20:00.
 *
 * Every comparison here takes an explicit IANA timezone — the user's Vikunja
 * `settings.timezone` — rather than the runtime's, so two clients on one
 * instance agree about which day a task falls on.
 */
export const DEFAULT_ALL_DAY_TIME = "20:00";

/**
 * The slice ships English strings only, so dates are formatted in English too
 * rather than mixing a localised weekday with an English "Today". When i18n
 * arrives this becomes the user's locale, in one place.
 */
export const UI_LOCALE = "en-GB";

export function parseVikunjaDate(value: string | null | undefined): Date | null {
  if (!value || value === VIKUNJA_NULL_DATE) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Vikunja writes year 1 for "unset" in more than one shape.
  if (date.getUTCFullYear() <= 1) return null;
  return date;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar day as YYYY-MM-DD in `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return dayFormatter(timeZone).format(date);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    timeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock time as HH:MM in `timeZone`. */
export function timeOfDay(date: Date, timeZone: string): string {
  return timeFormatter(timeZone).format(date);
}

/** Whole days from `from`'s calendar day to `to`'s, in `timeZone`. */
export function dayDifference(from: Date, to: Date, timeZone: string): number {
  const a = Date.parse(`${dayKey(from, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(to, timeZone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function classifySchedule(due: Date, now: Date, timeZone: string): ScheduleKind {
  const days = dayDifference(now, due, timeZone);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 7) return "next-week";
  return "later";
}

function normalizeAllDayTime(value: string | null | undefined): string {
  if (typeof value !== "string") return DEFAULT_ALL_DAY_TIME;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return DEFAULT_ALL_DAY_TIME;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return DEFAULT_ALL_DAY_TIME;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** True when the stored time is the all-day marker, so the UI shows a date only. */
export function isAllDay(
  due: Date,
  defaultDueTime: string | null | undefined,
  timeZone: string,
): boolean {
  return timeOfDay(due, timeZone) === normalizeAllDayTime(defaultDueTime);
}

export function formatDueLabel(
  due: Date,
  now: Date,
  timeZone: string,
  defaultDueTime: string | null | undefined,
  locale: string = UI_LOCALE,
): string {
  const days = dayDifference(now, due, timeZone);
  const allDay = isAllDay(due, defaultDueTime, timeZone);
  const time = allDay ? "" : ` ${timeOfDay(due, timeZone)}`;

  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days === -1) return `Yesterday${time}`;

  if (days > 1 && days <= 7) {
    const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(
      due,
    );
    return `${weekday}${time}`;
  }

  const sameYear =
    dayKey(due, timeZone).slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(due);
  return `${date}${time}`;
}
