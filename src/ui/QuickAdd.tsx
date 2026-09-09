import type { CSSProperties } from "react";
import { type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { classifySchedule, formatDueLabel } from "../model/dates";
import { scheduleColorVar } from "../model/display";
import { priorityFromVikunja, priorityLabel } from "../model/priority";
import { parseQuickAdd, type QuickAddContext } from "../model/quickadd/parse";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons/Icon";
import styles from "./QuickAdd.module.css";

export interface QuickAddProps {
  context: QuickAddContext;
  /**
   * Rejects to show the message inline; resolves with any non-fatal warnings
   * (a label that could not be attached, say) once the task is created.
   */
  onSubmit: (text: string) => Promise<string[]>;
  onCancel: () => void;
  busy?: boolean;
}

/** Splits the text into plain and highlighted runs, for the overlay. */
function runs(text: string, spans: { start: number; end: number }[]) {
  const out: { text: string; marked: boolean; start: number }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out.push({ text: text.slice(cursor, span.start), marked: false, start: cursor });
    }
    out.push({ text: text.slice(span.start, span.end), marked: true, start: span.start });
    cursor = span.end;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), marked: false, start: cursor });
  }
  return out;
}

export function QuickAdd({ context, onSubmit, onCancel, busy }: QuickAddProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [postWarnings, setPostWarnings] = useState<string[]>([]);
  /* Set synchronously, unlike `busy`, which arrives a render later: two Enters
     in the same turn would otherwise both read canSubmit === true and create
     the task twice. */
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(() => parseQuickAdd(text, context), [text, context]);

  // Focused on mount through the ref rather than the autofocus attribute: the
  // composer only exists once the user asked for it, so the caret belongs here.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /*
   * Grow the textarea to its content. Left at rows={1} with overflow hidden it
   * scrolled internally to follow the caret while the overlay did not, so past
   * about one line the marks sat under unrelated glyphs and the overlay painted
   * over the toolbar.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const project = context.projects.find((p) => p.id === parsed.effectiveProjectId);
  const dueKind = parsed.dueDate
    ? classifySchedule(parsed.dueDate, context.now, context.timeZone)
    : null;

  const canSubmit = parsed.title.trim().length > 0 && !busy;

  /** Discarding typed text asks first (layout-specs §5); an empty box does not. */
  const requestCancel = () => {
    // Never while a create is in flight: the request is not aborted, so the
    // task would be created moments after telling the user it was discarded.
    if (busy || submittingRef.current) return;
    if (text.trim().length === 0) onCancel();
    else setConfirmingDiscard(true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    const submitted = text;
    setError(null);
    setPostWarnings([]);
    try {
      const warnings = await onSubmit(submitted);
      // Clear only what was actually sent. Anything typed while the request
      // was in flight is the user's next task, not ours to throw away.
      setText((current) => (current === submitted ? "" : current));
      setPostWarnings(warnings);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the task.");
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      className={styles.wrapper}
      onSubmit={submit}
      onKeyDown={(event) => {
        // On the form, not the textarea: Escape has to work with the focus on
        // the Cancel or Add button too.
        if (event.key === "Escape") {
          event.preventDefault();
          requestCancel();
        }
      }}
    >
      <div className={styles.inputStack}>
        {/* Sits under the textarea and paints the recognised runs. */}
        <div className={styles.highlight} aria-hidden="true">
          {runs(text, parsed.spans).map((run) => (
            <Fragment key={`${run.start}-${run.text}`}>
              {run.marked ? <span className={styles.mark}>{run.text}</span> : run.text}
            </Fragment>
          ))}
        </div>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder="Task name"
          aria-label="Task name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
        />
      </div>

      <div className={styles.toolbar}>
        <span className={styles.chip}>
          <Icon name="project" size={16} />
          {project?.title ?? "Inbox"}
        </span>
        <span
          className={`${styles.chip} ${parsed.dueDate ? styles.chipSet : ""}`}
          style={
            dueKind
              ? ({ "--chip-color": scheduleColorVar(dueKind) } as CSSProperties)
              : undefined
          }
        >
          <Icon name="today" size={16} />
          {parsed.dueDate
            ? formatDueLabel(
                parsed.dueDate,
                context.now,
                context.timeZone,
                context.defaultDueTime,
              )
            : "Date"}
        </span>
        {parsed.priority === null ? null : (
          <span className={`${styles.chip} ${styles.chipSet}`}>
            <Icon name="flag" size={16} />
            {priorityLabel(priorityFromVikunja(parsed.priority))}
          </span>
        )}
        {parsed.repeatAfter === undefined ? null : (
          <span className={`${styles.chip} ${styles.chipSet}`}>
            <Icon name="upcoming" size={16} />
            Repeats
          </span>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={requestCancel}
            aria-label="Cancel"
          >
            <Icon name="close" size={16} />
          </button>
          <button
            type="submit"
            className={`${styles.iconButton} ${styles.submit}`}
            disabled={!canSubmit}
            aria-label="Add task"
          >
            <Icon name="check" size={16} />
          </button>
        </div>
      </div>

      {[...parsed.warnings, ...postWarnings].map((warning) => (
        <p key={warning} className={styles.warning}>
          {warning}
        </p>
      ))}
      {error ? <p className={styles.error}>{error}</p> : null}

      {confirmingDiscard ? (
        <ConfirmDialog
          title="Discard this task?"
          body="The text you typed will be lost."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setConfirmingDiscard(false);
            setText("");
            onCancel();
          }}
          onCancel={() => {
            setConfirmingDiscard(false);
            inputRef.current?.focus();
          }}
        />
      ) : null}
    </form>
  );
}

export function AddTaskAffordance({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles.affordance} onClick={onOpen}>
      <Icon name="plus" size={17} className={styles.affordanceIcon} />
      Add task
    </button>
  );
}
