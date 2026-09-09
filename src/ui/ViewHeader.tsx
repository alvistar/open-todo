import type { ReactNode } from "react";
import { Icon } from "./icons/Icon";
import styles from "./ViewHeader.module.css";

export interface ViewHeaderProps {
  title: string;
  /** e.g. "14 tasks". Adds the taller title tier when present. */
  subtitle?: string;
  breadcrumb?: ReactNode;
  onToggleTheme?: () => void;
  themeIcon?: "sun" | "moon";
}

/** The sticky toolbar tier, rendered outside the scrolling column. */
export function ViewToolbar({
  breadcrumb,
  onToggleTheme,
  themeIcon = "moon",
}: Pick<ViewHeaderProps, "breadcrumb" | "onToggleTheme" | "themeIcon">) {
  return (
    <div className={styles.toolbar}>
      {breadcrumb ? <div className={styles.breadcrumb}>{breadcrumb}</div> : null}
      <div className={styles.actions}>
        {onToggleTheme ? (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            <Icon name={themeIcon} size={24} />
          </button>
        ) : null}
        <button type="button" className={styles.toolbarButton} aria-label="View options">
          <Icon name="more" size={24} />
        </button>
      </div>
    </div>
  );
}

/** The title tier, rendered inside the 800px column. */
export function ViewTitle({
  title,
  subtitle,
}: Pick<ViewHeaderProps, "title" | "subtitle">) {
  return (
    <div className={`${styles.titleTier} ${subtitle ? styles.withSubtitle : ""}`}>
      <h1 className={styles.heading}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </div>
  );
}
