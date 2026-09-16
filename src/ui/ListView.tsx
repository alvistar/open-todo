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
  /**
   * Put `taskId` where `overId` currently sits. Ids rather than indices,
   * because the rendered list is not the array the order is computed against
   * — and because it is dnd-kit's own `active`/`over` pair.
   */
  onReorder?: (taskId: number, overId: number) => void;
  /**
   * Whether this list has an order that can be written (mapping §3). False
   * means no handle and no binding — a list that cannot keep an arrangement
   * must not appear to offer one.
   */
  reorderable?: boolean;
  /** Rendered above the sections (view header lives outside the scroll area). */
  header?: React.ReactNode;
}

export function ListView({
  sections,
  emptyMessage = "Nothing here.",
  onToggleDone,
  onUndo,
  onOpenTask,
  onReorder,
  reorderable = false,
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
    /*
     * Alt+Arrow moves the ROW, and has to be read before the modifier
     * bail-out below rather than inside the switch.
     *
     * Alt because the alternatives are taken: Cmd+Arrow is scroll-to-end on
     * macOS and Ctrl+Arrow switches Spaces. It shares its handler with the
     * drop gesture that arrives with dnd-kit, and unlike that gesture it can
     * be driven in jsdom, which is why the contract is pinned here.
     */
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!reorderable || !onReorder) return;
      const from = order.indexOf(task.id);
      const to = from + (event.key === "ArrowDown" ? 1 : -1);
      if (from < 0 || to < 0 || to >= order.length) return;
      const over = order[to];
      if (over === undefined) return;
      event.preventDefault();
      // The focus is not moved: the row keeps its React key, so the DOM node
      // travels with it and the focus goes along. Moving `active` as well
      // would be describing the same thing twice, in two places that can
      // disagree.
      onReorder(task.id, over);
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    /*
     * The map is Todoist's, measured from its own shortcut panel on
     * 2026-09-15 rather than invented: Enter opens the task, E completes the
     * selected ones, Z undoes, and J/K alias the arrows. The first cut of this
     * shipped Enter=complete only because there was nothing to open.
     */
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        move(-1);
        break;
      case "Enter":
        if (!onOpenTask) return;
        event.preventDefault();
        onOpenTask(task);
        break;
      case "e":
        if (!onToggleDone) return;
        event.preventDefault();
        onToggleDone(task);
        break;
      case "z":
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
