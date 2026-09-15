import type { CSSProperties } from "react";
import { scheduleColorVar, type TaskRowModel } from "../model/display";
import { Icon } from "./icons/Icon";
import { PriorityCheckbox } from "./PriorityCheckbox";
import styles from "./TaskRow.module.css";

export interface TaskRowProps {
  task: TaskRowModel;
  onToggleDone?: (task: TaskRowModel) => void;
  /** Only ever offered while `task.undoable`; see D-write. */
  onUndo?: (task: TaskRowModel) => void;
  onOpen?: (task: TaskRowModel) => void;
}

export function TaskRow({ task, onToggleDone, onUndo, onOpen }: TaskRowProps) {
  const dueStyle = task.due
    ? ({ "--schedule-color": scheduleColorVar(task.due.kind) } as CSSProperties)
    : undefined;

  return (
    <li>
      {/* biome-ignore lint/a11y/useSemanticElements: a <button> cannot contain the
          row's own checkbox button; the row is a composite click target. */}
      <div
        className={`${styles.row} ${task.done ? styles.done : ""}`}
        role="button"
        // Without this the row's accessible name is every scrap of text it
        // contains, including the checkbox's own label.
        aria-label={task.title}
        tabIndex={0}
        onClick={() => onOpen?.(task)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen?.(task);
          }
        }}
      >
        <span className={styles.check}>
          <PriorityCheckbox
            priority={task.priority}
            done={task.done}
            taskTitle={task.title}
            {...(onToggleDone ? { onToggle: () => onToggleDone(task) } : {})}
          />
        </span>
        <div className={styles.content}>
          <div className={styles.title}>{task.title}</div>
          {task.description ? (
            <div className={styles.description}>{task.description}</div>
          ) : null}
          <div className={styles.meta}>
            {task.subtasks && task.subtasks.total > 0 ? (
              <span
                className={styles.metaItem}
                role="img"
                aria-label={`${task.subtasks.done} of ${task.subtasks.total} subtasks done`}
              >
                <Icon name="subtask" size={12} />
                {task.subtasks.done}/{task.subtasks.total}
              </span>
            ) : null}
            {task.due ? (
              <span className={`${styles.metaItem} ${styles.due}`} style={dueStyle}>
                <Icon name="today" size={12} />
                {task.due.label}
              </span>
            ) : null}
            {task.hasReminder ? (
              <span className={styles.metaItem} role="img" aria-label="Has a reminder">
                <Icon name="bell" size={12} />
              </span>
            ) : null}
            {task.commentCount ? (
              <span
                className={styles.metaItem}
                role="img"
                aria-label={`${task.commentCount} comments`}
              >
                <Icon name="comment" size={12} />
                {task.commentCount}
              </span>
            ) : null}
            {/* The note and its Undo live in the meta row on purpose: it is
                already 16px tall, so a completed row keeps the measured 59/79px
                height of layout-specs §2.3 instead of growing a fourth line. */}
            {task.note ? (
              <span
                className={`${styles.metaItem} ${styles.note}`}
                role="status"
                title={task.note}
              >
                {task.note}
              </span>
            ) : null}
            {task.undoable && onUndo ? (
              <button
                type="button"
                className={styles.undo}
                onClick={(event) => {
                  event.stopPropagation();
                  onUndo(task);
                }}
              >
                Undo
              </button>
            ) : null}
            {task.projectName ? (
              <span className={styles.project}>
                {task.projectName}
                <Icon name="project" size={12} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
