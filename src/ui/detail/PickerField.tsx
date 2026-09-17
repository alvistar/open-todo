import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { registerPendingDraft, useDraftSource } from "../../lifecycle/drafts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/paths";
import { useOverlayLayer } from "../overlayStack";
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

export interface PickerFieldProps<TChange> {
  label: string;
  icon: IconName;
  /** How the current value reads on the closed row. */
  value: ReactNode;
  /** Greys the row, for "No date" and friends. */
  empty?: boolean;
  /**
   * Writes the change. Generic because not every sidebar row writes a COLUMN:
   * reminders are a sub-resource and travel a different route entirely.
   */
  onCommit: (change: TChange) => Promise<void>;
  /** The picker body. `commit` writes and closes; `busy` disables its controls. */
  children: (control: { commit: (change: TChange) => void; busy: boolean }) => ReactNode;
}

export function PickerField<TChange>({
  label,
  icon,
  value,
  empty = false,
  onCommit,
  children,
}: PickerFieldProps<TChange>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const pendingReleaseRef = useRef<(() => void) | null>(null);

  useDraftSource(`picker:${label}`, label, false, busy);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const closePicker = useCallback(() => {
    if (busy) return false;
    setOpen(false);
    triggerRef.current?.focus();
    return true;
  }, [busy]);

  useOverlayLayer("picker", closePicker, open);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;

    /* A click anywhere else closes the picker; the dialog behind stays live. */
    const onPointerDown = (event: MouseEvent) => {
      if (!root?.contains(event.target as Node)) closePicker();
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
      closePicker();
    };

    document.addEventListener("mousedown", onPointerDown);
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      root?.removeEventListener("keydown", onKeyDown);
    };
  }, [closePicker, open]);

  const commit = (change: TChange) => {
    pendingReleaseRef.current?.();
    setBusy(true);
    setError(null);
    const operation = Promise.resolve().then(() => onCommit(change));
    const release = registerPendingDraft(label, operation);
    pendingReleaseRef.current = release;
    void operation
      .then(() => {
        release();
        if (pendingReleaseRef.current === release) pendingReleaseRef.current = null;
        setOpen(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Could not save the change.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div ref={rootRef} className={styles.field}>
      <div className={styles.label}>{label}</div>
      <button
        ref={triggerRef}
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
