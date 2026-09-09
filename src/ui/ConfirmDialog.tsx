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

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className={styles.overlay}>
      {/* A real button, not a div with onClick: the click-outside target is
          then keyboard-reachable and needs no a11y escape hatch. */}
      <button
        type="button"
        className={styles.backdrop}
        aria-label={cancelLabel}
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
