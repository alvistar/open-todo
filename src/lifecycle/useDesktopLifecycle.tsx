import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useReducer, useRef, useState } from "react";
import { useOverlayLayer, useOverlayStack } from "../ui/overlayStack";
import { clearDraftErrors, getDraftSummary, useDraftSummary } from "./drafts";
import {
  type LifecycleRequest,
  type RequestState,
  sameRequest,
  transitionRequest,
} from "./requestState";
import styles from "./useDesktopLifecycle.module.css";

export type LifecycleKind = "close" | "quit";
export type LifecycleDecision = "allow" | "discard" | "cancel" | "exit-anyway";

export type { LifecycleRequest } from "./requestState";

interface LifecycleDecisionPayload {
  attemptId: number;
  generation: number;
  requestSequence: number;
  decision: LifecycleDecision;
  dirty: boolean;
  pending: boolean;
}

interface FrontendToken {
  instanceId: string;
  generation: number;
}

const INITIAL_REQUEST_STATE: RequestState = {
  current: null,
  inFlight: null,
  responseError: null,
};

/**
 * Connects the native close/quit coordinator to the current React draft
 * registry. The same guard is used for a window close and Command-Q.
 */
export function DesktopLifecycleBridge() {
  const [requestState, dispatchRequest] = useReducer(
    transitionRequest,
    INITIAL_REQUEST_STATE,
  );
  const [nativeError, setNativeError] = useState<string | null>(null);
  const request = requestState.current;
  const summary = useDraftSummary();
  const overlayStack = useOverlayStack();
  const requestRef = useRef(request);
  const requestStateRef = useRef(requestState);
  const responseIdRef = useRef(0);
  const instanceIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `desktop-${Math.random().toString(36).slice(2)}`,
  );
  requestRef.current = request;
  requestStateRef.current = requestState;
  const error =
    nativeError ?? requestState.responseError ?? summary.errors[0]?.error ?? null;
  const dismissibleDraftError = summary.errors.length > 0;
  const errorNotice = error ? (
    <ErrorNotice
      message={error}
      onDismiss={dismissibleDraftError ? clearDraftErrors : undefined}
    />
  ) : null;

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    let readyToken: FrontendToken | null = null;
    let unlistenRequest: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    const instanceId = instanceIdRef.current;

    void (async () => {
      try {
        unlistenRequest = await listen<LifecycleRequest>("lifecycle:request", (event) => {
          if (!mounted) return;
          setNativeError(null);
          // A recheck has the same attempt id. Replacing the object intentionally
          // lets the effect run again after native rejected an older snapshot.
          dispatchRequest({ type: "native-request", request: event.payload });
        });
        if (!mounted) {
          unlistenRequest();
          return;
        }
        unlistenError = await listen<{ message: string }>("lifecycle:error", (event) => {
          if (mounted) setNativeError(event.payload.message);
        });
        if (!mounted) {
          unlistenError();
          unlistenRequest();
          return;
        }
        const token = await invoke<FrontendToken | null>("lifecycle_ready", {
          instanceId,
        });
        if (!mounted) {
          if (token) {
            await invoke("lifecycle_unready", { token }).catch(() => undefined);
          }
          return;
        }
        readyToken = token;
      } catch {
        if (mounted) {
          setNativeError(
            "The desktop close guard could not connect. Try the action again.",
          );
        }
      }
    })();

    return () => {
      mounted = false;
      unlistenRequest?.();
      unlistenError?.();
      if (readyToken) {
        void invoke("lifecycle_unready", { token: readyToken }).catch(() => undefined);
      }
    };
  }, []);

  const respond = useRef(async (decision: LifecycleDecision) => {
    const current = requestRef.current;
    const inFlight = requestStateRef.current.inFlight;
    if (
      !current ||
      (decision !== "cancel" && inFlight && sameRequest(inFlight.request, current))
    ) {
      return;
    }
    const responseId = ++responseIdRef.current;
    dispatchRequest({ type: "response-started", request: current, responseId });
    setNativeError(null);
    const currentSummary = getDraftSummary();
    const payload: LifecycleDecisionPayload = {
      attemptId: current.attemptId,
      generation: current.generation,
      requestSequence: current.requestSequence,
      decision,
      dirty: currentSummary.dirty,
      pending: currentSummary.pending,
    };
    try {
      await invoke("lifecycle_decision", { payload });
      dispatchRequest({
        type: "response-settled",
        request: current,
        responseId,
        error: null,
      });
    } catch {
      dispatchRequest({
        type: "response-settled",
        request: current,
        responseId,
        error: "The desktop action could not be completed. The window remains open.",
      });
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
    return errorNotice;
  }

  return (
    <>
      <CloseGuard request={request} summary={summary} onRespond={respond} />
      {errorNotice}
    </>
  );
}

function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className={styles.error} role="status">
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" className={styles.errorDismiss} onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
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
