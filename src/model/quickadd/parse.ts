import { DEFAULT_ALL_DAY_TIME } from "../dates";
import { type Priority, priorityToVikunja } from "../priority";
import { matchDatePhrase, matchTimePhrase, zonedDate } from "./datePhrase";
import { matchRecurrence } from "./recurrence";

/*
 * Quick-add parsing (D-map-3, docs/data-model-mapping.md §5).
 *
 * open-todo accepts Todoist's sigils - #project, @label, p1..p4 - because that
 * is the muscle memory being targeted, plus Vikunja's own *label and !1..!5 so
 * text written for Vikunja's UI still parses.
 *
 * Two rules run through everything here:
 *
 *   1. An unrecognised token stays in the title, verbatim. Todoist does the
 *      same with an unknown @label, and it is the only honest behaviour: a
 *      task the user cannot see the text of is worse than an unparsed sigil.
 *   2. Nothing is approximated silently. A recurrence Vikunja cannot express is
 *      reported, not rounded.
 */

export interface QuickAddProject {
  id: number;
  title: string;
}

export interface QuickAddLabel {
  id: number;
  title: string;
}

export interface QuickAddContext {
  now: Date;
  timeZone: string;
  /** The user's Vikunja default_due_time, or null for the 20:00 fallback. */
  defaultDueTime: string | null;
  defaultProjectId: number | null;
  projects: QuickAddProject[];
  labels: QuickAddLabel[];
}

export type SpanKind = "date" | "time" | "project" | "label" | "priority" | "recurrence";

export interface QuickAddSpan {
  start: number;
  end: number;
  kind: SpanKind;
  text: string;
}

export interface QuickAddResult {
  /** The text with every recognised token removed. */
  title: string;
  projectId: number | null;
  /** projectId, or the default when the text named no project. */
  effectiveProjectId: number | null;
  labelIds: number[];
  /** The raw Vikunja `priority` to write, or null to leave it alone. */
  priority: number | null;
  dueDate: Date | null;
  /** True when the due time is the all-day marker (D-map-2). */
  allDay: boolean;
  repeatAfter?: number;
  repeatMode?: number;
  /** Ranges to highlight in the composer. Sorted, non-overlapping. */
  spans: QuickAddSpan[];
  /** Things the user should see before saving. */
  warnings: string[];
}

/** Replaces a range with spaces so later matchers skip it, keeping offsets. */
function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

function parseAllDayTime(value: string | null): { hours: number; minutes: number } {
  const raw = value ?? DEFAULT_ALL_DAY_TIME;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return { hours: 20, minutes: 0 };
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return { hours: 20, minutes: 0 };
  return { hours, minutes };
}

export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddResult {
  const spans: QuickAddSpan[] = [];
  const warnings: string[] = [];
  let rest = input;

  const consume = (start: number, end: number, kind: SpanKind) => {
    spans.push({ start, end, kind, text: input.slice(start, end) });
    rest = blank(rest, start, end);
  };

  /*
   * Hides a range from every later matcher WITHOUT removing it from the title.
   * Used for text that is recognised as one thing but not usable as it - an
   * unknown "@label", an unsupported repeat. Leaving it visible to the later
   * rules is how "@monday" became next Monday and "every 2nd tuesday" became a
   * one-off date: recognised, rejected, then silently reinterpreted.
   */
  const mask = (start: number, end: number) => {
    rest = blank(rest, start, end);
  };

  // Recurrence FIRST: "every monday" must not be eaten by the weekday date
  // matcher, which would schedule it once instead of repeating it.
  let repeatAfter: number | undefined;
  let repeatMode: number | undefined;
  const recurrence = matchRecurrence(rest);
  if (recurrence) {
    if (recurrence.rejected) {
      // The text stays in the title on purpose, so the user can see and fix
      // it - but it is masked from every later matcher. Without the mask the
      // date matcher reads the weekday out of "every 2nd tuesday" and quietly
      // schedules it for next Tuesday, which is the silent approximation this
      // whole path exists to avoid.
      mask(recurrence.start, recurrence.end);
      warnings.push(
        `"${recurrence.text.trim()}" is not supported by Vikunja and was kept in the task name.`,
      );
    } else {
      repeatAfter = recurrence.repeatAfter;
      repeatMode = recurrence.repeatMode;
      if (recurrence.warning) warnings.push(recurrence.warning);
      consume(recurrence.start, recurrence.end, "recurrence");
    }
  }

  /*
   * Sigils are extracted BEFORE dates. A project or label whose name is a date
   * word - "@monday", "#Lunedi", '#"Domani cose"' - was otherwise eaten from
   * the inside by the date matcher, leaving a bare "@" in the title and a due
   * date the user never asked for.
   */
  // #project — quoted for names with spaces, else a bare prefix.
  let projectId: number | null = null;
  const projectMatch = rest.match(/#"([^"]+)"/) ?? rest.match(/#([\p{L}\p{N}_-]+)/u);
  if (projectMatch) {
    const needle = (projectMatch[1] ?? "").toLowerCase();
    const candidates = context.projects.filter((p) =>
      p.title.toLowerCase().startsWith(needle),
    );
    // An exact title beats a longer project that merely starts the same way.
    const exact = candidates.find((p) => p.title.toLowerCase() === needle);
    const chosen = exact ?? candidates[0];
    if (chosen) {
      projectId = chosen.id;
      const start = projectMatch.index ?? 0;
      consume(start, start + projectMatch[0].length, "project");
    } else {
      // Unknown project: stays in the title verbatim (rule 1), but must not be
      // re-read as something else.
      const start = projectMatch.index ?? 0;
      mask(start, start + projectMatch[0].length);
    }
  }

  // @label / *label — existing labels only.
  const labelIds: number[] = [];
  // The lookbehind keeps "bob@work.com" from donating a "work" label, the same
  // guard the priority patterns already use.
  for (const m of [...rest.matchAll(/(?<![\p{L}\p{N}])[@*]([\p{L}\p{N}_-]+)/gu)]) {
    const needle = (m[1] ?? "").toLowerCase();
    const start = m.index ?? 0;
    const label = context.labels.find((l) => l.title.toLowerCase() === needle);
    if (!label) {
      // Unknown label stays as plain text, and is hidden from the date matcher
      // so "@monday" does not quietly become next Monday.
      mask(start, start + m[0].length);
      continue;
    }
    if (!labelIds.includes(label.id)) labelIds.push(label.id);
    consume(start, start + m[0].length, "label");
  }

  // p1..p4 through D-map-1; !1..!5 literally, because it is Vikunja's own
  // syntax and forcing it through D-map-1 would write 4 for !5.
  let priority: number | null = null;
  const pMatch = rest.match(/(?<![\p{L}\p{N}])p([1-4])(?![\p{L}\p{N}])/iu);
  if (pMatch) {
    priority = priorityToVikunja(Number(pMatch[1]) as Priority);
    const start = pMatch.index ?? 0;
    consume(start, start + pMatch[0].length, "priority");
  } else {
    const bangMatch = rest.match(/(?<![\p{L}\p{N}])!([1-5])(?![\p{L}\p{N}])/u);
    if (bangMatch) {
      priority = Number(bangMatch[1]);
      const start = bangMatch.index ?? 0;
      consume(start, start + bangMatch[0].length, "priority");
    }
  }

  // Date, then time. A time on its own is not a due date.
  let dueDate: Date | null = null;
  let allDay = false;
  const dateMatch = matchDatePhrase(rest, context.now, context.timeZone);
  if (dateMatch) {
    consume(dateMatch.start, dateMatch.end, "date");
    const timeMatch = matchTimePhrase(rest);
    if (timeMatch) {
      consume(timeMatch.start, timeMatch.end, "time");
      dueDate = timeMatch.apply(dateMatch.date, context.timeZone);
      allDay = false;
    } else {
      // D-map-2: a date with no time is stored at the all-day marker.
      const { hours, minutes } = parseAllDayTime(context.defaultDueTime);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: context.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(dateMatch.date);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      dueDate = zonedDate(
        get("year"),
        get("month"),
        get("day"),
        hours,
        minutes,
        context.timeZone,
      );
      allDay = true;
    }
  }

  spans.sort((a, b) => a.start - b.start);

  // The title is what is left once every recognised span is removed.
  let title = input;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    title = title.slice(0, span.start) + title.slice(span.end);
  }
  title = title.replace(/\s+/g, " ").trim();

  return {
    title,
    projectId,
    effectiveProjectId: projectId ?? context.defaultProjectId,
    labelIds,
    priority,
    dueDate,
    allDay,
    ...(repeatAfter === undefined ? {} : { repeatAfter }),
    ...(repeatMode === undefined ? {} : { repeatMode }),
    spans,
    warnings,
  };
}
