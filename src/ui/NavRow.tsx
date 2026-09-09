import type { CSSProperties } from "react";
import { Icon } from "./icons/Icon";
import type { IconName } from "./icons/paths";
import styles from "./NavRow.module.css";

export interface NavRowProps {
  icon: IconName;
  label: string;
  count?: number;
  selected?: boolean;
  /** Colours the icon only — used for a project's own colour. */
  iconColor?: string;
  /** Counts for Inbox/Today read in the accent colour (layout-specs §1). */
  accentCount?: boolean;
  onSelect?: () => void;
}

export function NavRow({
  icon,
  label,
  count,
  selected,
  iconColor,
  accentCount,
  onSelect,
}: NavRowProps) {
  const style = iconColor ? ({ "--icon-color": iconColor } as CSSProperties) : undefined;

  return (
    <li>
      <button
        type="button"
        className={`${styles.root} ${selected ? styles.selected : ""}`}
        style={style}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
      >
        <Icon name={icon} size={24} className={styles.icon} />
        <span className={styles.label}>{label}</span>
        {count === undefined || count === 0 ? (
          <span className={styles.count} />
        ) : (
          <span className={`${styles.count} ${accentCount ? styles.accentCount : ""}`}>
            {count}
          </span>
        )}
      </button>
    </li>
  );
}
