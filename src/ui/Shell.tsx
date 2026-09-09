import type { ReactNode } from "react";
import styles from "./Shell.module.css";

export interface ShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function Shell({ sidebar, children }: ShellProps) {
  return (
    <div className={styles.root}>
      {sidebar}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
