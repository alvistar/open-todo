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
  onOpenTask?: (task: TaskRowModel) => void;
  /** Rendered above the sections (view header lives outside the scroll area). */
  header?: React.ReactNode;
}

export function ListView({
  sections,
  emptyMessage = "Nothing here.",
  onToggleDone,
  onOpenTask,
  header,
  footer,
}: ListViewProps) {
  const total = sections.reduce((n, section) => n + section.tasks.length, 0);

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
                    {...(onToggleDone ? { onToggleDone } : {})}
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
