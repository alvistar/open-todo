import type { CSSProperties } from "react";
import { type Priority, priorityColorVar, priorityLabel } from "../model/priority";
import { Icon } from "./icons/Icon";
import styles from "./PriorityCheckbox.module.css";

export interface PriorityCheckboxProps {
  priority: Priority;
  done: boolean;
  taskTitle: string;
  onToggle?: () => void;
}

export function PriorityCheckbox({
  priority,
  done,
  taskTitle,
  onToggle,
}: PriorityCheckboxProps) {
  const style = { "--priority-color": priorityColorVar(priority) } as CSSProperties;
  const className = [styles.root, done ? styles.done : ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-pressed={done}
      aria-label={`${done ? "Reopen" : "Complete"} "${taskTitle}" (${priorityLabel(priority)})`}
      disabled={!onToggle}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
    >
      <span className={`${styles.box} ${priority !== 4 ? styles.tinted : ""}`}>
        <Icon name="check" size={12} className={styles.mark} />
      </span>
    </button>
  );
}
