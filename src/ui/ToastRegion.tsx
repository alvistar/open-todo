import { Icon } from "./icons/Icon";
import styles from "./ToastRegion.module.css";
import type { ToastApi } from "./useToasts";

/**
 * Where the toasts of D4 step 4 are rendered.
 *
 * Bottom left, clear of the quick-add composer at the foot of the list and of
 * the task-detail dialog, which is centred.
 *
 * Its geometry is NOT measured. The original reconnaissance never captured
 * Todoist's snackbar (`docs/layout-specs.md` has no §for it), so this is
 * derived from the nearest thing that WAS measured — the confirmation modal of
 * §5, 448 wide with a 12px radius — and built from the existing tokens rather
 * than invented colours. Say so before copying numbers out of it.
 */
export function ToastRegion({ toasts, dismiss }: ToastApi) {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.region}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.kind === "error" ? styles.error : ""}`}
          // A failure interrupts; a confirmation does not. Anything that
          // carries an action is polite too — an assertive live region would
          // cut across whatever the reader was doing to offer an Undo.
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span className={styles.message}>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                // Dismissed first, so a slow write does not leave a button the
                // reader can press twice.
                dismiss(toast.id);
                void toast.action?.run();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.close}
            aria-label={`Dismiss: ${toast.message}`}
            onClick={() => dismiss(toast.id)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
