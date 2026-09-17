import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useOverlayLayer, useOverlayStack } from "../ui/overlayStack";
import { getDraftSummary, useDraftSummary } from "./drafts";
import styles from "./useDesktopLifecycle.module.css";

export type LifecycleKind = "close" | "quit";
export type LifecycleDecision = "allow" | "discard" | "cancel" | "exit-anyway";

export interface LifecycleRequest {
  attemptId: number;
  generation: number;
  kind: LifecycleKind;
}

interface LifecycleDecisionPayload {
  attemptId: number;
  generation: number;
  decision: LifecycleDecision;
  dirty: boolean;
  pending: boolean;
}

function sameRequest(
  left: LifecycleRequest | null,
  right: LifecycleRequest | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.attemptId === right.attemptId &&
    left.generation === right.generation
  );
}

/**
 * Connects the native close/quit coordinator to the current React draft
 * registry. The same guard is used for a window close and Command-Q.
 */
export function DesktopLifecycleBridge() {
  const [request, setRequest] = useState<LifecycleRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useDraftSummary();
  const overlayStack = useOverlayStack();
  const requestRef = useRef(request);
  const respondingRef = useRef<LifecycleRequest | null>(null);
  const instanceIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `desktop-${Math.random().toString(36).slice(2)}`,
  );
  requestRef.current = request;

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    let ready = false;
    let unlistenRequest: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    const instanceId = instanceIdRef.current;

    void (async () => {
      try {
        unlistenRequest = await listen<LifecycleRequest>("lifecycle:request", (event) => {
          if (!mounted) return;
          setError(null);
          // A recheck has the same attempt id. Replacing the object intentionally
          // lets the effect run again after native rejected an older snapshot.
          setRequest(event.payload);
        });
        if (!mounted) {
          unlistenRequest();
          return;
        }
        unlistenError = await listen<{ message: string }>("lifecycle:error", (event) => {
          if (mounted) setError(event.payload.message);
        });
        if (!mounted) {
          unlistenError();
          unlistenRequest();
          return;
        }
        await invoke("lifecycle_ready", { instanceId });
        if (!mounted) {
          await invoke("lifecycle_unready", { instanceId }).catch(() => undefined);
          return;
        }
        ready = true;
      } catch {
        if (mounted) {
          setError("The desktop close guard could not connect. Try the action again.");
        }
      }
    })();

    return () => {
      mounted = false;
      unlistenRequest?.();
      unlistenError?.();
      if (ready) {
        void invoke("lifecycle_unready", { instanceId }).catch(() => undefined);
      }
    };
  }, []);

  const respond = useRef(async (decision: LifecycleDecision) => {
    const current = requestRef.current;
    if (!current || sameRequest(respondingRef.current, current)) return;
    respondingRef.current = current;
    setError(null);
    const currentSummary = getDraftSummary();
    const payload: LifecycleDecisionPayload = {
      attemptId: current.attemptId,
      generation: current.generation,
      decision,
      dirty: currentSummary.dirty,
      pending: currentSummary.pending,
    };
    try {
      await invoke("lifecycle_decision", { payload });
      if (sameRequest(requestRef.current, current)) setRequest(null);
    } catch {
      if (sameRequest(requestRef.current, current)) {
        setError("The desktop action could not be completed. The window remains open.");
      }
    } finally {
      if (sameRequest(respondingRef.current, current)) respondingRef.current = null;
    }
  }).current;

  useEffect(() => {
    if (!request || summary.pending || summary.dirty) return;
    void respond("allow");
  }, [request, summary, respond]);

  useEffect(() => {
    if (!request || overlayStack) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void respond("cancel");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [overlayStack, request, respond]);

  if (!request || (!summary.dirty && !summary.pending)) {
    return error ? <p className={styles.error}>{error}</p> : null;
  }

  return (
    <>
      <CloseGuard request={request} summary={summary} onRespond={respond} />
      {error ? <p className={styles.error}>{error}</p> : null}
    </>
  );
}

function CloseGuard({
  request,
  summary,
  onRespond,
}: {
  request: LifecycleRequest;
  summary: ReturnType<typeof getDraftSummary>;
  onRespond: (decision: LifecycleDecision) => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useOverlayLayer("alertdialog", () => onRespond("cancel"));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const action = request.kind === "quit" ? "quit" : "close";
  const sources = summary.sources.map((source) => source.label).join(", ");

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="desktop-close-title"
      >
        <h1 className={styles.title} id="desktop-close-title">
          {summary.pending
            ? "A save is still in progress"
            : `${action === "quit" ? "Quit" : "Close"} open-todo?`}
        </h1>
        {summary.pending ? (
          <p className={styles.body}>
            Staying keeps your draft while the server responds. Exiting anyway may lose
            the local draft, and the server-side outcome may be unknown.
          </p>
        ) : (
          <p className={styles.body}>
            You have unsaved changes{sources ? ` in ${sources}` : ""}. Keep editing or
            discard them before you {action}.
          </p>
        )}
        <div className={styles.actions}>
          <button
            ref={stayRef}
            type="button"
            className={styles.secondary}
            onClick={() => onRespond("cancel")}
          >
            Stay
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => onRespond(summary.pending ? "exit-anyway" : "discard")}
          >
            {summary.pending
              ? "Exit anyway"
              : `${action === "quit" ? "Discard and quit" : "Discard and close"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
