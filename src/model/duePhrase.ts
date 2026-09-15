import { parseQuickAdd, type QuickAddContext } from "./quickadd/parse";

/**
 * Reads the date picker's "Type a date" field.
 *
 * It runs the same acceptor the composer runs, so the two fields cannot drift:
 * a phrase open-todo refuses in one place is refused in the other. The WORDS
 * differ on purpose - the composer says the text was kept in the task name,
 * which is not true of a field that holds no task name. D-vocab holds here
 * too: out of grammar means no date is invented and the user is told why.
 *
 * The field sets a date and NOTHING else. A phrase that also carries a name, a
 * project, a label, a priority or a repeat is refused rather than half-applied,
 * because silently dropping the half we cannot write is how a wrong date gets
 * saved without anyone noticing.
 */

export interface DuePhrase {
  /** The date to write, or null when the phrase was refused. */
  due: Date | null;
  /** True when the time is the all-day marker (D-map-2). */
  allDay: boolean;
  /** Why it was refused, in the user's words. Null when `due` is set. */
  reason: string | null;
}

const REFUSED = (reason: string): DuePhrase => ({ due: null, allDay: false, reason });

export function dueDateFromPhrase(phrase: string, context: QuickAddContext): DuePhrase {
  if (!phrase.trim()) return REFUSED("Type a date.");

  const parsed = parseQuickAdd(phrase, context);

  if (parsed.repeatAfter !== undefined || parsed.repeatMode !== undefined) {
    return REFUSED("This field sets a date, not a repeat.");
  }
  if (parsed.dueDate === null) {
    /*
     * The acceptor's DECISION is shared; its sentence is not. Its warnings end
     * "and was kept in the task name", which is true in the composer and false
     * here - this field holds no task name, and saying so sends the reader
     * looking for a title that was never involved. Found by driving the app.
     */
    return REFUSED(`"${phrase.trim()}" is not a date open-todo reads.`);
  }
  if (
    parsed.projectId !== null ||
    parsed.labelIds.length > 0 ||
    parsed.priority !== null
  ) {
    return REFUSED("This field sets a date and nothing else.");
  }

  const leftover = parsed.title.trim();
  if (leftover) {
    return REFUSED(
      `Read a date, but not "${leftover}". This field takes a date on its own.`,
    );
  }

  return { due: parsed.dueDate, allDay: parsed.allDay, reason: null };
}

export interface DueShortcut {
  label: string;
  /** Sent through `dueDateFromPhrase`, so a shortcut is only ever a phrase. */
  phrase: string;
}

/**
 * The four shortcuts Todoist offers above its calendar, measured 2026-09-15.
 *
 * Each is a phrase rather than a computed date, so the button and the field
 * below it cannot disagree about what "tomorrow" means. "This weekend" is the
 * one that is not literal: the acceptor does not read that phrase (it warns and
 * keeps it in the title), and teaching it to would move the 738-record fixture
 * for a button. The coming Saturday is what the label means anyway.
 *
 * `duePhrase.test.ts` asserts every phrase here still resolves, so a grammar
 * change that breaks one fails the suite instead of the button.
 */
export const DUE_SHORTCUTS: readonly DueShortcut[] = [
  { label: "Today", phrase: "today" },
  { label: "Tomorrow", phrase: "tomorrow" },
  { label: "This weekend", phrase: "saturday" },
  { label: "Next week", phrase: "next week" },
];
