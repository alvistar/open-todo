import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Transient messages that have nowhere else to land (D4 step 4).
 *
 * Deliberately NOT a replacement for the nine inline `role="status"` messages
 * in this app. D-detail put each of those beside the field it belongs to
 * because a failed write must not take what you typed out of sight, and
 * D-write put a completion's message on the ROW so a self-hosted instance does
 * not feel like it is thinking. What is left over is what this is for: a write
 * that succeeded and took its row off the screen, and one that failed with no
 * row left to say so on.
 */

/** How long a confirmation stays. Matches the row linger of D-write. */
export const INFO_MS = 6000;
/**
 * And a failure, which stays twice as long for the reason D-write gives: it
 * has to be read, where a confirmation only has to be noticed.
 */
export const ERROR_MS = 10_000;

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastInput {
  message: string;
  kind?: "info" | "error";
  action?: ToastAction;
}

export interface Toast extends ToastInput {
  id: number;
  kind: "info" | "error";
}

export interface ToastApi {
  toasts: readonly Toast[];
  show: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      // Cleared, not merely left to fire: a surviving timer would later run
      // against a list that no longer holds this toast.
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;
      const toast: Toast = { ...input, id, kind: input.kind ?? "info" };
      setToasts((current) => [...current, toast]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toast.kind === "error" ? ERROR_MS : INFO_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      /*
       * Clearing the timers is the whole guard. Deliberately NOT a "live" flag
       * consulted before setState: that is the shape the repo got wrong once
       * already (§7 item 9), where the flag latched false after StrictMode's
       * remount and switched the undo window off in `pnpm dev` while leaving a
       * production build fine — correct where nobody looks, broken where the
       * app is actually run.
       */
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, show, dismiss };
}
