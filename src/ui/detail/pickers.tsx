import { useState } from "react";
import type { TaskPatch } from "../../api/endpoints";
import { type Task, type TaskReminder, VIKUNJA_NULL_DATE } from "../../api/types";
import { DUE_SHORTCUTS, type DuePhrase } from "../../model/duePhrase";
import {
  PRIORITIES,
  type Priority,
  priorityLabel,
  priorityToVikunja,
} from "../../model/priority";
import {
  canRemindRelatively,
  describeReminder,
  REMINDER_PRESETS,
  relativeReminder,
} from "../../model/reminders";
import styles from "./pickers.module.css";

/** The bodies the sidebar's `PickerField` renders. Each one only calls `commit`. */

interface Control<TChange = TaskPatch> {
  commit: (change: TChange) => void;
  busy: boolean;
}

export interface OptionPickerProps<T> extends Control {
  options: readonly { id: T; label: string }[];
  current: T;
  toPatch: (id: T) => TaskPatch;
}

function OptionList<T extends string | number>({
  options,
  current,
  toPatch,
  commit,
  busy,
}: OptionPickerProps<T>) {
  return (
    <ul className={styles.options}>
      {options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`${styles.option} ${option.id === current ? styles.current : ""}`}
            aria-current={option.id === current}
            disabled={busy}
            onClick={() => commit(toPatch(option.id))}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PriorityPicker({
  current,
  commit,
  busy,
}: Control & { current: Priority }) {
  return (
    <OptionList
      options={PRIORITIES.map((p) => ({ id: p, label: priorityLabel(p) }))}
      current={current}
      toPatch={(p) => ({ priority: priorityToVikunja(p) })}
      commit={commit}
      busy={busy}
    />
  );
}

export interface ProjectOption {
  id: number;
  title: string;
}

export function ProjectPicker({
  projects,
  current,
  commit,
  busy,
}: Control & { projects: readonly ProjectOption[]; current: number }) {
  return (
    <OptionList
      options={projects.map((p) => ({ id: p.id, label: p.title }))}
      current={current}
      toPatch={(id) => ({ project_id: id })}
      commit={commit}
      busy={busy}
    />
  );
}

/**
 * The date picker: the shortcuts, then the natural-language field.
 *
 * Both go through the SAME `readPhrase`, so the buttons and the field cannot
 * disagree about what "tomorrow" means. It is a callback rather than a parsing
 * context because the clock has to be read when the user picks: the composer
 * already carries the scar of a memoised `now`, where a tab left open
 * overnight kept parsing "tomorrow" against yesterday.
 *
 * Clearing writes Vikunja's null date rather than omitting the column - under
 * the bulk `fields` guard an omitted column is re-read from the stored row, so
 * omission would leave the date exactly where it was.
 */
export function DuePicker({
  hasDate,
  readPhrase,
  commit,
  busy,
}: Control & { hasDate: boolean; readPhrase: (phrase: string) => DuePhrase }) {
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState<string | null>(null);

  const apply = (text: string) => {
    const result = readPhrase(text);
    if (result.due === null) {
      setReason(result.reason);
      return;
    }
    setReason(null);
    commit({ due_date: result.due.toISOString() });
  };

  return (
    <div>
      <ul className={styles.options}>
        {DUE_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.label}>
            <button
              type="button"
              className={styles.option}
              disabled={busy}
              onClick={() => apply(shortcut.phrase)}
            >
              {shortcut.label}
            </button>
          </li>
        ))}
        {hasDate ? (
          <li>
            <button
              type="button"
              className={styles.option}
              disabled={busy}
              onClick={() => {
                setReason(null);
                commit({ due_date: VIKUNJA_NULL_DATE });
              }}
            >
              No date
            </button>
          </li>
        ) : null}
      </ul>
      <input
        className={styles.phrase}
        aria-label="Type a date"
        placeholder="Type a date"
        value={phrase}
        disabled={busy}
        onChange={(event) => {
          setPhrase(event.target.value);
          setReason(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          apply(phrase);
        }}
      />
      {reason ? (
        <p className={styles.reason} role="status">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The reminder picker.
 *
 * Relative offsets are only offered when the task HAS a due date - they are
 * measured from one, so on a task without a date they would be anchored to
 * nothing and never fire. Saying that is better than hiding the row and
 * leaving the reader to wonder.
 *
 * An absolute reminder reuses the date field's reader, so "tomorrow at 9" is
 * read by the same grammar everywhere in the app.
 */
export function ReminderPicker({
  task,
  now,
  timeZone,
  defaultDueTime,
  readPhrase,
  commit,
  busy,
}: Control<TaskReminder[]> & {
  task: Task;
  now: Date;
  timeZone: string;
  defaultDueTime: string | null;
  readPhrase: (phrase: string) => DuePhrase;
}) {
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const current = task.reminders ?? [];
  const relative = canRemindRelatively(task);

  /* The whole new set, every time: Vikunja replaces the list rather than merging. */
  const without = (index: number) => current.filter((_, i) => i !== index);

  const addAbsolute = () => {
    const result = readPhrase(phrase);
    if (result.due === null) {
      setReason(result.reason);
      return;
    }
    setReason(null);
    commit([...current, { reminder: result.due.toISOString() }]);
  };

  return (
    <div>
      {current.length > 0 ? (
        <ul className={styles.options}>
          {current.map((reminder, index) => (
            <li key={`${reminder.reminder ?? ""}:${reminder.relative_period ?? ""}`}>
              <button
                type="button"
                className={styles.option}
                disabled={busy}
                aria-label={`Remove the reminder ${describeReminder(reminder, now, timeZone, defaultDueTime)}`}
                onClick={() => commit(without(index))}
              >
                {describeReminder(reminder, now, timeZone, defaultDueTime)}
                <span className={styles.remove} aria-hidden="true">
                  ×
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {relative ? (
        <ul className={styles.options}>
          {REMINDER_PRESETS.map((preset) => (
            <li key={preset.seconds}>
              <button
                type="button"
                className={styles.option}
                disabled={busy}
                onClick={() => commit([...current, relativeReminder(preset.seconds)])}
              >
                {preset.label}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>
          Give the task a date to be reminded before it is due.
        </p>
      )}
      <input
        className={styles.phrase}
        aria-label="Remind me at"
        placeholder="Remind me at…"
        value={phrase}
        disabled={busy}
        onChange={(event) => {
          setPhrase(event.target.value);
          setReason(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          addAbsolute();
        }}
      />
      {reason ? (
        <p className={styles.reason} role="status">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
