import type { CSSProperties } from "react";
import { type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { classifySchedule, formatDueLabel } from "../model/dates";
import { scheduleColorVar } from "../model/display";
import { priorityFromVikunja, priorityLabel } from "../model/priority";
import { type Decision, off, on, withDecisions } from "../model/quickadd/decisions";
import {
  parseQuickAdd,
  type QuickAddContext,
  type QuickAddSpan,
  type SpanKind,
} from "../model/quickadd/parse";
import { DAY, MONTH, WEEK, YEAR } from "../model/quickadd/recurrence";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons/Icon";
import styles from "./QuickAdd.module.css";

export interface QuickAddProps {
  context: QuickAddContext;
  /**
   * Rejects to show the message inline; resolves with any non-fatal warnings
   * (a label that could not be attached, say) once the task is created.
   */
  onSubmit: (text: string, decisions: Decision[]) => Promise<string[]>;
  onCancel: () => void;
  busy?: boolean;
}

interface Run {
  text: string;
  start: number;
  /** Absent on the plain stretches between spans. */
  span?: QuickAddSpan;
}

/** Splits the text into plain and recognised runs, for the overlay. */
function runs(text: string, spans: QuickAddSpan[]): Run[] {
  const out: Run[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out.push({ text: text.slice(cursor, span.start), start: cursor });
    }
    out.push({ text: text.slice(span.start, span.end), start: span.start, span });
    cursor = span.end;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), start: cursor });
  }
  return out;
}

/**
 * How a recognised run is painted. A span that is not APPLIED keeps its words
 * in the task name, so it must not look the same as one that was taken out of
 * it: `off` is a value the user switched off, `suggested` is one the parser
 * reported without acting on (D-adverb).
 */
function markClass(span: QuickAddSpan): string {
  if (span.suggested && span.off) return `${styles.mark} ${styles.markSuggested}`;
  if (span.off) return `${styles.mark} ${styles.markOff}`;
  return styles.mark ?? "";
}

/** How an unaccepted repeat offer reads. English only; see DESIGN.md UI_LOCALE. */
function repeatOffer(span: QuickAddSpan): string {
  const seconds = span.suggestedRepeat?.repeatAfter;
  const word = (
    [
      [DAY, "daily"],
      [WEEK, "weekly"],
      [MONTH, "monthly"],
      [YEAR, "yearly"],
    ] as const
  ).find(([value]) => value === seconds)?.[1];
  return word ? `Repeat ${word}?` : "Repeat?";
}

export function QuickAdd({ context, onSubmit, onCancel, busy }: QuickAddProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [postWarnings, setPostWarnings] = useState<string[]>([]);
  /*
   * What the user said about the things the parser recognised. Keyed by kind
   * and text, never offsets, so it survives the re-parse that runs on every
   * keystroke. Cleared with the text, never mid-typing.
   */
  const [decisions, setDecisions] = useState<Decision[]>([]);
  /* Set synchronously, unlike `busy`, which arrives a render later: two Enters
     in the same turn would otherwise both read canSubmit === true and create
     the task twice. */
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(
    () =>
      withDecisions(
        parseQuickAdd(text, context),
        text,
        decisions,
        context.defaultProjectId,
      ),
    [text, context, decisions],
  );

  const decide = (decision: Decision) =>
    setDecisions((current) => [
      ...current.filter((d) => !(d.kind === decision.kind && d.text === decision.text)),
      decision,
    ]);

  /** The span a chip speaks for, if the line produced one. */
  const spanOf = (kind: SpanKind) => parsed.spans.find((span) => span.kind === kind);

  /*
   * The × on a chip whose value came from the text (layout-specs §3). It
   * switches the value off; the words go back into the task name rather than
   * being deleted, because the user is rejecting the READING, not the words.
   */
  const removeButton = (kind: SpanKind, label: string) => {
    const span = spanOf(kind);
    if (!span || span.off) return null;
    return (
      <button
        type="button"
        className={styles.chipRemove}
        aria-label={label}
        onClick={() => decide(off(kind, span.text))}
      >
        <Icon name="close" size={12} />
      </button>
    );
  };

  const repeatSpan = spanOf("recurrence");

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
   *
   * `text` is a TRIGGER, not a read: the body measures the DOM, which has
   * already been given the new value by the time this runs. Biome sees an
   * unused dependency and offers to drop it - that fix would stop the box
   * growing altogether. It cannot be moved into `onChange` either, because
   * `text` is also reset after a submit and cleared by the toolbar, and both
   * of those need the box to shrink back.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: text is what must re-run this, not what it reads.
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
      const warnings = await onSubmit(submitted, decisions);
      // Clear only what was actually sent. Anything typed while the request
      // was in flight is the user's next task, not ours to throw away.
      setText((current) => (current === submitted ? "" : current));
      setDecisions([]);
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
              {run.span ? (
                <span className={markClass(run.span)}>{run.text}</span>
              ) : (
                run.text
              )}
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
          {removeButton("project", "Remove the project")}
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
          {parsed.dueDate ? removeButton("date", "Remove the due date") : null}
        </span>
        {parsed.priority === null ? null : (
          <span className={`${styles.chip} ${styles.chipSet}`}>
            <Icon name="flag" size={16} />
            {priorityLabel(priorityFromVikunja(parsed.priority))}
            {removeButton("priority", "Remove the priority")}
          </span>
        )}
        {/*
         * Three states, not two. A bare adverb is REPORTED and not applied
         * (D-adverb), so the chip is the offer - a button you press to mean
         * it - and only then does it become an ordinary set chip with a ×.
         */}
        {repeatSpan?.suggested && repeatSpan.off ? (
          <button
            type="button"
            className={`${styles.chip} ${styles.chipSuggested}`}
            aria-pressed={false}
            onClick={() => decide(on("recurrence", repeatSpan.text))}
          >
            <Icon name="upcoming" size={16} />
            {repeatOffer(repeatSpan)}
          </button>
        ) : parsed.repeatAfter === undefined ? null : (
          <span className={`${styles.chip} ${styles.chipSet}`}>
            <Icon name="upcoming" size={16} />
            Repeats
            {removeButton("recurrence", "Remove the repeat")}
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

      {/* Announced: the composer changes these without the focus moving. */}
      <div role="status">
        {[...parsed.warnings, ...postWarnings].map((warning) => (
          <p key={warning} className={styles.warning}>
            {warning}
          </p>
        ))}
      </div>
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
