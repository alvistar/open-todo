import { Icon } from "./icons/Icon";
import { NavRow } from "./NavRow";
import styles from "./Sidebar.module.css";

export interface SidebarProject {
  id: number;
  title: string;
  /** Vikunja `hex_color`, already prefixed with "#", or undefined for the default. */
  color?: string;
  count?: number;
}

export interface SidebarProps {
  userName: string;
  selected: string;
  inboxCount?: number;
  todayCount?: number;
  projects: SidebarProject[];
  onSelect: (route: string) => void;
  onLogOut?: () => void;
  onAddTask?: () => void;
}

export function Sidebar({
  userName,
  selected,
  inboxCount,
  todayCount,
  projects,
  onSelect,
  onLogOut,
  onAddTask,
}: SidebarProps) {
  return (
    <nav className={styles.root} aria-label="Views and projects">
      <div className={styles.account}>
        <span className={styles.accountName}>{userName}</span>
        <div className={styles.accountActions}>
          <button type="button" className={styles.iconButton} aria-label="Notifications">
            <Icon name="bell" size={24} />
          </button>
        </div>
      </div>

      <button
        type="button"
        className={styles.addTask}
        onClick={onAddTask}
        disabled={!onAddTask}
      >
        <Icon name="plus" size={24} className={styles.addTaskIcon} />
        <span className={styles.addTaskLabel}>Add task</span>
      </button>

      <ul className={styles.nav}>
        <NavRow
          icon="search"
          label="Search"
          selected={selected === "search"}
          onSelect={() => onSelect("search")}
        />
        <NavRow
          icon="inbox"
          label="Inbox"
          accentCount
          {...(inboxCount === undefined ? {} : { count: inboxCount })}
          selected={selected === "inbox"}
          onSelect={() => onSelect("inbox")}
        />
        <NavRow
          icon="today"
          label="Today"
          accentCount
          {...(todayCount === undefined ? {} : { count: todayCount })}
          selected={selected === "today"}
          onSelect={() => onSelect("today")}
        />
        <NavRow
          icon="upcoming"
          label="Upcoming"
          selected={selected === "upcoming"}
          onSelect={() => onSelect("upcoming")}
        />
        <NavRow
          icon="labels"
          label="Filters & labels"
          selected={selected === "labels"}
          onSelect={() => onSelect("labels")}
        />
      </ul>

      <div className={styles.group}>
        <div className={styles.groupHeader}>
          My projects
          <div className={styles.groupActions}>
            <button
              type="button"
              className={styles.smallIconButton}
              aria-label="Add project"
              disabled
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
        </div>
        <ul>
          {projects.map((project) => (
            <NavRow
              key={project.id}
              icon="project"
              label={project.title}
              {...(project.color ? { iconColor: project.color } : {})}
              {...(project.count === undefined ? {} : { count: project.count })}
              selected={selected === `project/${project.id}`}
              onSelect={() => onSelect(`project/${project.id}`)}
            />
          ))}
        </ul>
      </div>

      <div className={styles.footer}>
        {onLogOut ? (
          <button type="button" className={styles.footerRow} onClick={onLogOut}>
            <Icon name="close" size={24} className={styles.footerIcon} />
            Log out
          </button>
        ) : null}
        <span className={styles.version}>open-todo v{__APP_VERSION__}</span>
      </div>
    </nav>
  );
}
