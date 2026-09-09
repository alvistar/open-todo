import type { ReactNode } from "react";
import styles from "./SectionHeader.module.css";

export interface SectionHeaderProps {
  title: string;
  count?: number;
  first?: boolean;
  action?: ReactNode;
}

export function SectionHeader({ title, count, first, action }: SectionHeaderProps) {
  return (
    <div className={`${styles.root} ${first ? styles.first : ""}`}>
      <h2 className={styles.title}>{title}</h2>
      {count === undefined ? null : <span className={styles.count}>{count}</span>}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
