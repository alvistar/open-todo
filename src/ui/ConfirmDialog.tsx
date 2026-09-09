import { useEffect, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** layout-specs §5. Used when discarding a composer that still has text. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Read through a ref so the effects below do not depend on a callback the
  // parent recreates on every render.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  /*
   * Focus on mount, once. With `onCancel` in the dependency list this re-ran on
   * every parent render - and the 20s poll tick renders the parent - so focus
   * jumped back to Discard while the user was on Keep editing. Pressing Enter
   * then destroyed the text they had just chosen to keep.
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.overlay}>
      {/* A real button, not a div with onClick: the click-outside target is
          then keyboard-reachable and needs no a11y escape hatch. */}
      <button
        type="button"
        className={styles.backdrop}
        aria-label={cancelLabel}
        // Out of the tab order: a full-viewport button would otherwise take a
        // tab stop and draw the focus ring around the whole window.
        tabIndex={-1}
        onClick={onCancel}
      />
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className={styles.header}>
          <h1 className={styles.title} id="confirm-title">
            {title}
          </h1>
        </div>
        <p className={styles.body}>{body}</p>
        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
