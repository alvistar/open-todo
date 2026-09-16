import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TaskPatch } from "../../api/endpoints";
import type { Label, Task, TaskComment, TaskReminder } from "../../api/types";
import { formatDueLabel, parseVikunjaDate } from "../../model/dates";
import type { DuePhrase } from "../../model/duePhrase";
import { priorityFromVikunja, priorityLabel } from "../../model/priority";
import { describeReminder } from "../../model/reminders";
import { isRichHtml, stripHtml, toDescriptionHtml } from "../../model/taskRow";
import type { TitleEdit } from "../../model/titleEdit";
import { ConfirmDialog } from "../ConfirmDialog";
import { Icon } from "../icons/Icon";
import { PriorityCheckbox } from "../PriorityCheckbox";
import { Comments } from "./Comments";
import { EditableField } from "./EditableField";
import { PickerField } from "./PickerField";
import {
  DuePicker,
  type LabelChange,
  LabelPicker,
  PriorityPicker,
  type ProjectOption,
  ProjectPicker,
  ReminderPicker,
} from "./pickers";
import styles from "./TaskDetail.module.css";

/**
 * The task detail, at the geometry measured in docs/layout-specs.md §4.
 *
 * Read-only for now: it renders what the task already carries. Editing arrives
 * field by field, each with the write it needs. What it must NOT do meanwhile
 * is offer controls that do nothing - this app has shipped two of those
 * already, and both were found by someone else.
 *
 * The task comes from the open view's cached list rather than a query of its
 * own, so the 20s poll keeps an open dialog current and the two existing
 * `queryKey[0] === "tasks"` invalidations keep working untouched.
 */

export interface TaskDetailProps {
  task: Task;
  /** The project the breadcrumb names. */
  projectName: string;
  /** Every project this task can be moved to, in the order the picker lists them. */
  projects: readonly ProjectOption[];
  /**
   * Reads the date field's phrases with the composer's own acceptor. A callback
   * so the clock is read at the moment of the pick, not when the dialog opened.
   */
  readDuePhrase: (phrase: string) => DuePhrase;
  /**
   * Replaces the whole reminder set. Separate from `onSave` because reminders
   * are not a column: they travel outside the bulk `fields` guard entirely.
   */
  onSaveReminders: (reminders: TaskReminder[]) => Promise<void>;
  /** Every label the instance has, for the picker to choose among. */
  allLabels: readonly Label[];
  /** One label on or off. A sub-resource call, so one pick is one write. */
  onChangeLabel: (change: LabelChange) => Promise<void>;
  /**
   * Deleting the task. Absent means the "⋯" menu is not drawn at all, rather
   * than drawn with a dead item — the rule this dialog was built on.
   */
  onDelete?: () => void;
  /**
   * Reads an edited NAME the way the composer reads a new one. A callback, for
   * the same reason `readDuePhrase` is one: the clock must be read now, not
   * when the dialog opened.
   */
  readTitleEdit: (raw: string) => TitleEdit;
  /** Saves an edited name and everything its phrase named, in one go. */
  onSaveTitle: (raw: string) => Promise<void>;
  comments: readonly TaskComment[];
  commentsLoading: boolean;
  onAddComment: (html: string) => Promise<void>;
  /** Creates a task under this one, in this one's project. */
  onAddSubtask: (title: string) => Promise<void>;
  now: Date;
  timeZone: string;
  defaultDueTime: string | null;
  onClose: () => void;
  /** Writes the named columns. Rejecting keeps the editor open with its text. */
  onSave: (values: TaskPatch) => Promise<void>;
  /** Absent at the ends of the list; the buttons are then disabled. */
  onPrev?: () => void;
  onNext?: () => void;
}

export function TaskDetail({
  task,
  projectName,
  projects,
  readDuePhrase,
  onSaveReminders,
  allLabels,
  onChangeLabel,
  onDelete,
  readTitleEdit,
  onSaveTitle,
  comments,
  commentsLoading,
  onAddComment,
  onAddSubtask,
  now,
  timeZone,
  defaultDueTime,
  onClose,
  onSave,
  onPrev,
  onNext,
}: TaskDetailProps) {
  /** At most one editor is open, so the dialog holds which. */
  const [editing, setEditing] = useState<"title" | "description" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /*
   * Every way out of this dialog goes through one function, so the question is
   * asked once rather than at each door. Read through a ref by the key
   * handler, which must not be rebuilt on every render.
   */
  const requestCloseRef = useRef<() => void>(() => {});
  /*
   * Whether the open editor holds work nobody has saved. Closing the whole
   * pane over it loses the same text Cancel would, by a wider door — so the
   * dialog asks the question its Cancel asks.
   *
   * Beyond the measurement, and said plainly: the reference product was
   * measured guarding the EDITOR's own Cancel (2026-09-16). Whether its X
   * guards too was not captured, and guessing loudly here is safer than
   * guessing quietly.
   */
  const [dirty, setDirty] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  /** Close, unless there is unsaved work to ask about first. */
  const requestClose = () => {
    if (dirty) setConfirmingClose(true);
    else onClose();
  };
  requestCloseRef.current = requestClose;
  /*
   * The name being typed, mirrored here ONLY so the sidebar can show what the
   * phrase would set. The editor still owns the draft - this is a copy that
   * nothing writes back, so the 20s poll cannot re-seed what is being typed.
   */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Read through a ref so the effects do not depend on a callback the parent
  // recreates on every render - the 20s poll renders the parent, and
  // ConfirmDialog has the scar from exactly that.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  /* The page behind must not scroll under the overlay. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (/^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);

      if (event.key === "Escape") {
        /*
         * Escape belongs to the dialog, not to an open editor. Todoist does
         * not discard on Escape either, and if it did here the key would carry
         * two destructive meanings at once - throw away the text AND close the
         * pane it was in. Cancel is the only discard.
         */
        if (typing) return;
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      /*
       * The focus trap ConfirmDialog does without. It can, being two buttons
       * over a list nobody can reach past; this one is a full pane over a page
       * that is still tabbable, and Tab would walk out of the dialog and leave
       * the user typing into the list behind the overlay.
       */
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* What the name being typed would set. Null whenever the name is at rest. */
  const pending =
    editing === "title" && titleDraft !== null ? readTitleEdit(titleDraft) : null;

  const closeEditor = () => {
    setEditing(null);
    setTitleDraft(null);
  };

  const due = parseVikunjaDate(task.due_date);
  const description = task.description ? stripHtml(task.description) : "";
  const subtasks = task.related_tasks?.subtask ?? [];
  const labels = task.labels ?? [];
  const reminders = task.reminders ?? [];

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close the task"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        {confirmingClose ? (
          <ConfirmDialog
            title="Discard unsaved changes?"
            body="Unsaved changes will be lost."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            onConfirm={() => {
              setConfirmingClose(false);
              onClose();
            }}
            onCancel={() => setConfirmingClose(false)}
          />
        ) : null}
        <div className={styles.header}>
          <span className={styles.crumb}>
            <Icon name="project" size={16} />
            {projectName}
          </span>
          <div className={styles.actions}>
            <span className={styles.pair}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Previous task"
                disabled={!onPrev}
                onClick={onPrev}
              >
                <Icon name="chevronLeft" size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Next task"
                disabled={!onNext}
                onClick={onNext}
              >
                <Icon name="chevronRight" size={16} />
              </button>
            </span>
            {onDelete ? (
              /*
               * The "⋯" of layout-specs §4's header, which was measured from
               * the start and never drawn because there was nothing it could
               * honour. Delete is the first thing there is.
               *
               * It opens a menu rather than acting: a 32px button between
               * prev/next and Close that deleted a task on one click would be
               * the worst possible neighbour for the close button.
               */
              <span className={styles.overflow}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((was) => !was)}
                >
                  <Icon name="more" size={16} />
                </button>
                {menuOpen ? (
                  <div className={styles.menu} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                    >
                      Delete task
                    </button>
                  </div>
                ) : null}
              </span>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              className={styles.iconButton}
              aria-label="Close"
              onClick={() => requestClose()}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <div className={`${styles.main} ${task.done ? styles.done : ""}`}>
            <div className={styles.overview}>
              <span className={styles.check}>
                <PriorityCheckbox
                  priority={priorityFromVikunja(task.priority)}
                  done={task.done}
                  taskTitle={task.title}
                />
              </span>
              <div className={styles.text}>
                <h1 className={styles.title} id="task-detail-title">
                  <EditableField
                    value={task.title}
                    label="Edit the task name"
                    editing={editing === "title"}
                    onEdit={() => {
                      setEditing("title");
                      setTitleDraft(task.title);
                    }}
                    onClose={closeEditor}
                    onDraft={setTitleDraft}
                    onDirty={setDirty}
                    onSave={onSaveTitle}
                    {...(pending && pending.warnings.length > 0
                      ? { notice: pending.warnings.join(" ") }
                      : {})}
                  >
                    {task.title}
                  </EditableField>
                </h1>
                <div className={styles.description}>
                  <EditableField
                    value={description}
                    label="Edit the description"
                    multiline
                    editing={editing === "description"}
                    onEdit={() => setEditing("description")}
                    onDirty={setDirty}
                    onClose={closeEditor}
                    onSave={(next) => onSave({ description: toDescriptionHtml(next) })}
                    {...(isRichHtml(task.description)
                      ? {
                          notice:
                            "This description was written with formatting open-todo cannot keep. Saving here turns it into plain text.",
                        }
                      : {})}
                  >
                    <span className={description ? "" : styles.placeholder}>
                      {description || "No description"}
                    </span>
                  </EditableField>
                </div>
                <div className={styles.subtasks}>
                  {subtasks.length > 0 ? (
                    <ul className={styles.subtaskList}>
                      {subtasks.map((subtask) => (
                        <li
                          key={subtask.id}
                          className={`${styles.subtask} ${subtask.done ? styles.subtaskDone : ""}`}
                        >
                          <Icon name="subtask" size={16} />
                          {subtask.title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <SubtaskComposer onAdd={onAddSubtask} />
                </div>
                <Comments
                  comments={comments}
                  loading={commentsLoading}
                  onAdd={onAddComment}
                />
              </div>
            </div>
          </div>

          <div className={styles.sidebar}>
            <div className={styles.fields}>
              <PickerField
                label="Project"
                icon="project"
                value={
                  <Pending on={pending?.preview.projectId != null}>
                    {pending?.preview.projectId == null
                      ? projectName
                      : (projects.find((p) => p.id === pending.preview.projectId)
                          ?.title ?? projectName)}
                  </Pending>
                }
                onCommit={onSave}
              >
                {(control) => (
                  <ProjectPicker
                    projects={projects}
                    current={task.project_id}
                    {...control}
                  />
                )}
              </PickerField>
              <hr className={styles.rule} />
              <PickerField
                label="Date"
                icon="today"
                value={
                  <Pending on={pending?.preview.dueDate != null}>
                    {(() => {
                      const shown = pending?.preview.dueDate ?? due;
                      return shown
                        ? formatDueLabel(shown, now, timeZone, defaultDueTime)
                        : "No date";
                    })()}
                  </Pending>
                }
                empty={!due && !pending?.preview.dueDate}
                onCommit={onSave}
              >
                {(control) => (
                  <DuePicker
                    hasDate={due !== null}
                    readPhrase={readDuePhrase}
                    {...control}
                  />
                )}
              </PickerField>
              <hr className={styles.rule} />
              <PickerField
                label="Priority"
                icon="flag"
                value={
                  <Pending on={pending?.preview.priority != null}>
                    {priorityLabel(
                      priorityFromVikunja(pending?.preview.priority ?? task.priority),
                    )}
                  </Pending>
                }
                onCommit={onSave}
              >
                {(control) => (
                  <PriorityPicker
                    current={priorityFromVikunja(task.priority)}
                    {...control}
                  />
                )}
              </PickerField>
              <hr className={styles.rule} />
              <PickerField
                label="Labels"
                icon="labels"
                value={
                  <Pending on={(pending?.addLabelIds.length ?? 0) > 0}>
                    {(() => {
                      const names = [
                        ...labels.map((label) => label.title),
                        ...(pending?.addLabelIds ?? []).map(
                          (id) =>
                            allLabels.find((label) => label.id === id)?.title ??
                            "a label",
                        ),
                      ];
                      return names.length > 0 ? names.join(", ") : "None";
                    })()}
                  </Pending>
                }
                empty={labels.length === 0 && (pending?.addLabelIds.length ?? 0) === 0}
                onCommit={onChangeLabel}
              >
                {(control) => (
                  <LabelPicker attached={labels} all={allLabels} {...control} />
                )}
              </PickerField>
              <hr className={styles.rule} />
              <PickerField
                label="Reminders"
                icon="bell"
                value={
                  reminders.length > 0
                    ? reminders
                        .map((reminder) =>
                          describeReminder(reminder, now, timeZone, defaultDueTime),
                        )
                        .join(", ")
                    : "None"
                }
                empty={reminders.length === 0}
                onCommit={onSaveReminders}
              >
                {(control) => (
                  <ReminderPicker
                    task={task}
                    now={now}
                    timeZone={timeZone}
                    defaultDueTime={defaultDueTime}
                    readPhrase={readDuePhrase}
                    {...control}
                  />
                )}
              </PickerField>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A sidebar value that is not saved yet.
 *
 * The owner chose the sidebar as the ONE place that says what an edited name
 * would do - no chips beside the field - so this marking is the whole feedback
 * channel, and it has to reach a screen reader too, not just the eye.
 */
function Pending({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <span className={styles.pending}>
      {children}
      <span className={styles.offscreen}> (when you save)</span>
    </span>
  );
}

/**
 * Adds a sub-task by name.
 *
 * Its own component so the draft is its own state, which is what keeps the 20s
 * poll from clearing a half-typed name out from under the user.
 */
function SubtaskComposer({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(title);
      // Cleared on success only: a failed add must not eat the name.
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the sub-task.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        className={styles.subtaskInput}
        aria-label="Add a sub-task"
        placeholder="Add a sub-task"
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void add();
        }}
      />
      {error ? (
        <p className={styles.subtaskError} role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
