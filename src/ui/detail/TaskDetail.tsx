import { useEffect, useRef } from "react";
import type { Task } from "../../api/types";
import { formatDueLabel, parseVikunjaDate } from "../../model/dates";
import { priorityFromVikunja, priorityLabel } from "../../model/priority";
import { stripHtml } from "../../model/taskRow";
import { Icon } from "../icons/Icon";
import { PriorityCheckbox } from "../PriorityCheckbox";
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
  now: Date;
  timeZone: string;
  defaultDueTime: string | null;
  onClose: () => void;
  /** Absent at the ends of the list; the buttons are then disabled. */
  onPrev?: () => void;
  onNext?: () => void;
}

export function TaskDetail({
  task,
  projectName,
  now,
  timeZone,
  defaultDueTime,
  onClose,
  onPrev,
  onNext,
}: TaskDetailProps) {
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
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
            <button
              ref={closeRef}
              type="button"
              className={styles.iconButton}
              aria-label="Close"
              onClick={onClose}
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
                  {task.title}
                </h1>
                <p
                  className={`${styles.description} ${description ? "" : styles.placeholder}`}
                >
                  {description || "No description"}
                </p>
                {subtasks.length > 0 ? (
                  <div className={styles.subtasks}>
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
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className={styles.sidebar}>
            <div className={styles.fields}>
              <div>
                <div className={styles.fieldLabel}>Project</div>
                <div className={styles.fieldValue}>
                  <Icon name="project" size={16} />
                  {projectName}
                </div>
              </div>
              <hr className={styles.rule} />
              <div>
                <div className={styles.fieldLabel}>Date</div>
                <div className={`${styles.fieldValue} ${due ? "" : styles.fieldEmpty}`}>
                  <Icon name="today" size={16} />
                  {due ? formatDueLabel(due, now, timeZone, defaultDueTime) : "No date"}
                </div>
              </div>
              <hr className={styles.rule} />
              <div>
                <div className={styles.fieldLabel}>Priority</div>
                <div className={styles.fieldValue}>
                  <Icon name="flag" size={16} />
                  {priorityLabel(priorityFromVikunja(task.priority))}
                </div>
              </div>
              <hr className={styles.rule} />
              <div>
                <div className={styles.fieldLabel}>Labels</div>
                <div
                  className={`${styles.fieldValue} ${labels.length > 0 ? "" : styles.fieldEmpty}`}
                >
                  <Icon name="labels" size={16} />
                  {labels.length > 0
                    ? labels.map((label) => label.title).join(", ")
                    : "None"}
                </div>
              </div>
              <hr className={styles.rule} />
              <div>
                <div className={styles.fieldLabel}>Reminders</div>
                <div
                  className={`${styles.fieldValue} ${reminders.length > 0 ? "" : styles.fieldEmpty}`}
                >
                  <Icon name="bell" size={16} />
                  {reminders.length > 0 ? reminderLabel(reminders.length) : "None"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Counted rather than described: the relative forms need their own editor. */
function reminderLabel(count: number): string {
  return `${count} ${count === 1 ? "reminder" : "reminders"}`;
}
