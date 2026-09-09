import type { CSSProperties } from "react";
import { scheduleColorVar, type TaskRowModel } from "../model/display";
import { Icon } from "./icons/Icon";
import { PriorityCheckbox } from "./PriorityCheckbox";
import styles from "./TaskRow.module.css";

export interface TaskRowProps {
  task: TaskRowModel;
  /** Read-only in the foundation slice; the toggle arrives with the mutation slice. */
  onToggleDone?: (task: TaskRowModel) => void;
  onOpen?: (task: TaskRowModel) => void;
}

export function TaskRow({ task, onToggleDone, onOpen }: TaskRowProps) {
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
