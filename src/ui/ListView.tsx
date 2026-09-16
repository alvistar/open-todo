import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, useMemo, useRef, useState } from "react";
import type { TaskRowModel } from "../model/display";
import { Icon } from "./icons/Icon";
import styles from "./ListView.module.css";
import { mergeRefs } from "./mergeRefs";
import { SectionHeader } from "./SectionHeader";
import { TaskRow } from "./TaskRow";
import rowStyles from "./TaskRow.module.css";

/**
 * A task row that can be picked up.
 *
 * The load-bearing decision: `attributes` and `listeners` go on the HANDLE,
 * never on the row.
 *
 * `useSortable`'s attributes carry their own `role="button"` and `tabIndex=0`.
 * On the row they would collide with the row's deliberate `role="button"` —
 * which has a biome suppression and a reason — and would make every row
 * tabbable again, undoing the one-tab-stop model D4 step 2 exists to provide.
 * On the handle they are harmless and bring dnd-kit's keyboard path and its
 * live-region announcements with them.
 *
 * It also means the row's own click-to-open and key handling are untouched:
 * the pointer sensor never sees them.
 */
function SortableRow({
  task,
  rowProps,
}: {
  task: TaskRowModel;
  rowProps: Omit<React.ComponentProps<typeof TaskRow>, "task">;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, attributes: { tabIndex: -1 } });

  const dragStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskRow
      task={task}
      {...rowProps}
      rowRef={mergeRefs(rowProps.rowRef, setNodeRef)}
      dragStyle={dragStyle}
      dragging={isDragging}
      dragHandle={
        <button
          type="button"
          className={rowStyles.handle}
          {...attributes}
          {...listeners}
          // After the spread, so it is this file that decides: focusable, so
          // dnd-kit's keyboard path exists, but never a tab stop — the list is
          // one stop, and Alt+Arrow is the documented way to move a row.
          tabIndex={-1}
          aria-label={`Move ${task.title}`}
          // The row beneath opens the task on click; picking it up must not.
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="grip" size={16} />
        </button>
      }
    />
  );
}

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
  /*
   * Which section a row is in.
   *
   * Sections and order are two different things once a list is position
   * ordered: Today's "Overdue" and "16 Sept" come from each task's DUE DATE,
   * while the order comes from its position. So a section's rows are NOT
   * contiguous in the position space, and a move across the boundary would
   * write a perfectly correct position and then render the row straight back
   * where it came from, because its date has not changed - a gesture that
   * visibly does nothing.
   *
   * Crossing that boundary means "reschedule", which is a different and
   * destructive intent nobody expressed by dragging. So it is refused.
   */
  const sectionOf = useMemo(() => {
    const map = new Map<number, string>();
    for (const section of sections) {
      for (const task of section.tasks) map.set(task.id, section.key);
    }
    return map;
  }, [sections]);
  const sameSection = (a: number, b: number) =>
    sectionOf.get(a) !== undefined && sectionOf.get(a) === sectionOf.get(b);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click that wobbles
    // still opens the task rather than picking it up.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (!sameSection(Number(active.id), Number(over.id))) return;
    onReorder?.(Number(active.id), Number(over.id));
  };

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
      if (!sameSection(task.id, over)) return;
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

  const body =
    total === 0 ? (
      <p className={styles.empty}>{emptyMessage}</p>
    ) : (
      <>
        {sections.map((section, index) => (
          <section key={section.key} className={styles.section}>
            {section.title ? (
              <SectionHeader
                title={section.title}
                {...(section.count === undefined ? {} : { count: section.count })}
                first={index === 0}
              />
            ) : null}
            <ul className={styles.list}>
              <SortableContext
                items={section.tasks.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
                disabled={!reorderable}
              >
                {section.tasks.map((task) => {
                  const rowProps = {
                    tabIndex: task.id === tabStop ? 0 : -1,
                    onKeyDown: rowKeyDown(task),
                    rowRef: (el: HTMLDivElement | null) => {
                      if (el) rows.current.set(task.id, el);
                      else rows.current.delete(task.id);
                    },
                    ...(onToggleDone ? { onToggleDone } : {}),
                    ...(onUndo ? { onUndo } : {}),
                    ...(onOpenTask ? { onOpen: onOpenTask } : {}),
                  };
                  return reorderable ? (
                    <SortableRow key={task.id} task={task} rowProps={rowProps} />
                  ) : (
                    <TaskRow key={task.id} task={task} {...rowProps} />
                  );
                })}
              </SortableContext>
            </ul>
          </section>
        ))}
      </>
    );

  return (
    <div className={styles.scroll}>
      <div className={styles.column}>
        {header}
        {/*
         * The drag context wraps the SECTIONS only — not the header, and not
         * the footer, which is where the quick-add composer renders. Same
         * reason the key handler hangs off each row rather than this
         * container: a context up here would be listening to a text field.
         */}
        {reorderable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            {body}
          </DndContext>
        ) : (
          body
        )}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
