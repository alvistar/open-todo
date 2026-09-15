import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TaskPatch } from "../../api/endpoints";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import styles from "./PickerField.module.css";

/**
 * A sidebar row whose value opens a picker.
 *
 * The commit model is the opposite of the main column's, and both were
 * measured in Todoist on 2026-09-15: **picking writes.** There is no Save and
 * no Cancel anywhere in the picker, and a pick made while the title editor is
 * open survives that editor's Cancel - the two are independent, verified by
 * experiment rather than assumed.
 *
 * A failed write keeps the picker open and says why, because with no Save
 * button to stay behind, closing on failure would leave the old value on
 * screen with nothing to explain it.
 */

export interface PickerFieldProps {
  label: string;
  icon: IconName;
  /** How the current value reads on the closed row. */
  value: ReactNode;
  /** Greys the row, for "No date" and friends. */
  empty?: boolean;
  onCommit: (values: TaskPatch) => Promise<void>;
  /** The picker body. `commit` writes and closes; `busy` disables its controls. */
  children: (control: {
    commit: (values: TaskPatch) => void;
    busy: boolean;
  }) => ReactNode;
}

export function PickerField({
  label,
  icon,
  value,
  empty = false,
  onCommit,
  children,
}: PickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;

    /* A click anywhere else closes the picker; the dialog behind stays live. */
    const onPointerDown = (event: MouseEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    /*
     * Escape closes the picker and must not reach the dialog, which would close
     * too and take the picker's error message with it. The dialog listens on
     * window, so stopping the bubble at this root is enough. It is a listener
     * rather than a JSX handler because the node it belongs on is a plain
     * container - giving that container an onKeyDown would be a keyboard
     * handler on something no one can focus.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      root?.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commit = (values: TaskPatch) => {
    setBusy(true);
    setError(null);
    void onCommit(values)
      .then(() => {
        setOpen(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not save the change.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div ref={rootRef} className={styles.field}>
      <div className={styles.label}>{label}</div>
      <button
        type="button"
        className={`${styles.value} ${empty ? styles.empty : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}: ${open ? "close" : "change"}`}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name={icon} size={16} />
        <span className={styles.valueText}>{value}</span>
      </button>
      {open ? (
        <fieldset className={styles.popover} aria-label={label}>
          {children({ commit, busy })}
          {error ? (
            <p className={styles.error} role="status">
              {error}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
