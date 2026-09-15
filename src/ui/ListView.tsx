import { useMemo, useRef, useState } from "react";
import type { TaskRowModel } from "../model/display";
import styles from "./ListView.module.css";
import { SectionHeader } from "./SectionHeader";
import { TaskRow } from "./TaskRow";

export interface TaskSection {
  key: string;
  title?: string;
  count?: number;
  tasks: TaskRowModel[];
}

export interface ListViewProps {
  sections: TaskSection[];
  /** Rendered under the last section: the quick-add affordance or composer. */
  footer?: React.ReactNode;
  emptyMessage?: string;
  onToggleDone?: (task: TaskRowModel) => void;
  onUndo?: (task: TaskRowModel) => void;
  onOpenTask?: (task: TaskRowModel) => void;
  /** Rendered above the sections (view header lives outside the scroll area). */
  header?: React.ReactNode;
}

export function ListView({
  sections,
  emptyMessage = "Nothing here.",
  onToggleDone,
  onUndo,
  onOpenTask,
  header,
  footer,
}: ListViewProps) {
  const total = sections.reduce((n, section) => n + section.tasks.length, 0);

  /*
   * One tab stop for the whole list, arrows inside it.
   *
   * Every row used to be tabbable and each carries its own checkbox button, so
   * a fifty-task view was over a hundred Tab presses to step past - which is
   * the same as having no keyboard support, only slower. This is the roving
   * tabindex the list pattern asks for: `active` is the row Tab lands on, and
   * the arrows move it.
   */
  const [active, setActive] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());

  const order = useMemo(
    () => sections.flatMap((section) => section.tasks.map((task) => task.id)),
    [sections],
  );
  // The row Tab reaches: the last one focused, or the first in the list. A
  // stale id (the task was completed and left) falls back to the first.
  const tabStop = active !== null && order.includes(active) ? active : order[0];

  const move = (delta: number) => {
    if (order.length === 0) return;
    const from = tabStop === undefined ? 0 : order.indexOf(tabStop);
    const next = order[Math.min(Math.max(from + delta, 0), order.length - 1)];
    if (next === undefined) return;
    setActive(next);
    rows.current.get(next)?.focus();
  };

  /*
   * Attached to each ROW rather than to this container. The row is what holds
   * the focus, and the composer renders inside this container's footer - a
   * handler up here would also see every keystroke typed into a task name, so
   * "u" would undo while you were spelling "usare".
   */
  const rowKeyDown = (task: TaskRowModel) => (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        if (!onToggleDone) return;
        event.preventDefault();
        onToggleDone(task);
        break;
      case "u":
        if (!task.undoable || !onUndo) return;
        event.preventDefault();
        onUndo(task);
        break;
    }
  };

  return (
    <div className={styles.scroll}>
      <div className={styles.column}>
        {header}
        {total === 0 ? (
          <p className={styles.empty}>{emptyMessage}</p>
        ) : (
          sections.map((section, index) => (
            <section key={section.key} className={styles.section}>
              {section.title ? (
                <SectionHeader
                  title={section.title}
                  {...(section.count === undefined ? {} : { count: section.count })}
                  first={index === 0}
                />
              ) : null}
              <ul className={styles.list}>
                {section.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    tabIndex={task.id === tabStop ? 0 : -1}
                    onKeyDown={rowKeyDown(task)}
                    rowRef={(el) => {
                      if (el) rows.current.set(task.id, el);
                      else rows.current.delete(task.id);
                    }}
                    {...(onToggleDone ? { onToggleDone } : {})}
                    {...(onUndo ? { onUndo } : {})}
                    {...(onOpenTask ? { onOpen: onOpenTask } : {})}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
