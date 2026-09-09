import type { Task } from "../api/types";
import type { LiveEvent, LiveSource } from "./LiveSource";
import { diffDeleted, latestUpdated } from "./reconcile";

/**
 * How to express "what changed since last time" to the server.
 *
 * `server-relative` is preferred and is what this instance family supports
 * (`updated >= now-30s`, verified against Vikunja 2.5.0): the server evaluates
 * the window, so the browser's clock never enters the comparison. The number of
 * seconds is a *duration* measured by the browser, and durations are reliable
 * even when the absolute clock is wrong.
 *
 * `timestamp` is the fallback for a server that rejects `now-<n>s`.
 */
export type PollWindow =
  | { kind: "server-relative"; seconds: number }
  | { kind: "timestamp"; since: Date };

export interface PollingSourceOptions {
  /** Incremental fetch of everything that changed within the window. */
  fetchSince: (window: PollWindow, signal?: AbortSignal) => Promise<Task[]>;
  /**
   * Ask the server to evaluate the window. Set false only when the instance
   * rejects `updated >= now-<n>s`.
   */
  serverRelativeWindow?: boolean;
  /** Full fetch of the open view, used to find deletions. */
  fetchAll: (signal?: AbortSignal) => Promise<Task[]>;
  /** What the view currently holds, for the id-set diff. */
  getCurrent: () => Task[];

  intervalMs?: number;
  /** Do a full fetch every Nth tick; deletions are only visible there. */
  fullFetchEvery?: number;
  /** Re-ask slightly before the last mark, so an equal-timestamp write is not missed. */
  overlapMs?: number;
  /**
   * How far back to reach when no server timestamp is known yet (empty view).
   * Only this bootstrap value depends on the browser clock.
   */
  bootstrapLookbackMs?: number;
  /** Collapses a burst of focus/visibility events into one tick. */
  debounceMs?: number;

  now?: () => Date;
  isVisible?: () => boolean;
  setInterval?: (handler: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  onError?: (error: unknown) => void;
}

const DEFAULTS = {
  intervalMs: 20_000,
  fullFetchEvery: 5,
  overlapMs: 2_000,
  debounceMs: 300,
  bootstrapLookbackMs: 60_000,
};

/**
 * Polls the open view while the tab is visible (D6).
 *
 * Two fetch shapes, because they answer different questions: the incremental
 * one (`updated >= mark`) finds edits cheaply but can never report a deletion,
 * since `deleted_at` is not filterable (mapping §6 item 3). So every Nth tick,
 * and on every refreshNow(), a full fetch of the view runs and its id set is
 * diffed against what the UI holds.
 */
export function createPollingSource(options: PollingSourceOptions): LiveSource {
  const intervalMs = options.intervalMs ?? DEFAULTS.intervalMs;
  const fullFetchEvery = options.fullFetchEvery ?? DEFAULTS.fullFetchEvery;
  const overlapMs = options.overlapMs ?? DEFAULTS.overlapMs;
  const debounceMs = options.debounceMs ?? DEFAULTS.debounceMs;
  const bootstrapLookbackMs = options.bootstrapLookbackMs ?? DEFAULTS.bootstrapLookbackMs;
  const serverRelativeWindow = options.serverRelativeWindow ?? true;

  const now = options.now ?? (() => new Date());
  const isVisible = options.isVisible ?? (() => document.visibilityState === "visible");
  const setIntervalFn = options.setInterval ?? ((h, ms) => window.setInterval(h, ms));
  const clearIntervalFn = options.clearInterval ?? ((h) => window.clearInterval(h));
  const setTimeoutFn = options.setTimeout ?? ((h, ms) => window.setTimeout(h, ms));
  const clearTimeoutFn = options.clearTimeout ?? ((h) => window.clearTimeout(h));
  const addListener =
    options.addEventListener ?? ((t, l) => window.addEventListener(t, l));
  const removeListener =
    options.removeEventListener ?? ((t, l) => window.removeEventListener(t, l));

  const listeners = new Set<(event: LiveEvent) => void>();
  let started = false;
  let intervalHandle: number | null = null;
  let debounceHandle: number | null = null;
  let controller: AbortController | null = null;
  /*
   * The incremental mark. After bootstrap it is always a timestamp the SERVER
   * produced (`task.updated`), never the browser's clock, because it is sent
   * back as `updated >= mark` and compared against server time.
   *
   * A browser clock even a minute fast used to kill incremental polling
   * outright: every fetch asked for changes in the future and returned
   * nothing, forever, silently degrading refresh from 20s to the ~100s full
   * fetch. Correcting against the server clock is not available either - the
   * `Date` response header is not CORS-safelisted and reads as null
   * cross-origin (mapping §6 item 10).
   *
   * Tracking the newest `updated` we have seen is self-correcting and cheap:
   * on a quiet instance the query returns just the task that carries that
   * timestamp, and on a busy one the mark keeps pace with real edits.
   */
  let mark = now();
  let markIsFromServer = false;
  /** When the last successful fetch completed, for measuring elapsed time. */
  let lastFetchAt: Date | null = null;
  let tickCount = 0;
  let inFlight = false;
  /** A refreshNow() that arrived while a tick was running. */
  let pendingForce = false;
  /** A full fetch that failed and must not lose its turn in the cadence. */
  let retryFull = false;

  function emit(event: LiveEvent): void {
    for (const listener of listeners) listener(event);
  }

  /**
   * The incremental window. Server-relative uses the elapsed time since the
   * last successful fetch — a browser *duration*, which stays correct however
   * wrong the browser's absolute clock is.
   */
  function incrementalWindow(): PollWindow {
    if (!serverRelativeWindow) {
      return { kind: "timestamp", since: new Date(mark.getTime() - overlapMs) };
    }
    const elapsedMs = lastFetchAt ? now().getTime() - lastFetchAt.getTime() : intervalMs;
    const seconds = Math.ceil((Math.max(elapsedMs, 0) + overlapMs) / 1000);
    return { kind: "server-relative", seconds };
  }

  /** True when the gap since the last fetch is too wide for an incremental one. */
  function gapTooWide(): boolean {
    if (!lastFetchAt) return false;
    return now().getTime() - lastFetchAt.getTime() > intervalMs * fullFetchEvery;
  }

  async function runTick(force: boolean): Promise<void> {
    if (!force && !isVisible()) return;
    // One request at a time: a slow server must not queue ticks up behind it.
    // A forced refresh is remembered rather than discarded - it is how the app
    // will reconcile straight after its own mutation (mapping §7 item 1).
    if (inFlight) {
      if (force) pendingForce = true;
      return;
    }

    inFlight = true;
    controller = new AbortController();
    // A long hidden stretch is reconciled in full: an incremental window that
    // wide is no cheaper than the full fetch, and the full one finds deletions.
    const full = force || retryFull || gapTooWide() || tickCount % fullFetchEvery === 0;
    tickCount += 1;

    try {
      let fetched: Task[];
      if (full) {
        fetched = await options.fetchAll(controller.signal);
        // Diff against what the UI holds *before* the reset is applied.
        const removed = diffDeleted(options.getCurrent(), fetched);
        emit({ type: "reset", tasks: fetched });
        if (removed.length > 0) emit({ type: "delete", ids: removed });
      } else {
        fetched = await options.fetchSince(incrementalWindow(), controller.signal);
        if (fetched.length > 0) emit({ type: "upsert", tasks: fetched });
      }
      retryFull = false;
      lastFetchAt = now();

      // Advance ONLY on a server-produced timestamp. Never on the browser
      // clock, and never past the newest thing the server actually reported:
      // a task edited while the page walk was in progress must still be
      // re-read next tick.
      const newest = latestUpdated(fetched);
      if (newest && (!markIsFromServer || newest > mark)) {
        mark = newest;
        markIsFromServer = true;
      }
    } catch (error) {
      // A full fetch is the only thing that detects deletions, so a failed one
      // keeps its turn instead of waiting another whole cadence.
      if (full) retryFull = true;
      if ((error as { name?: string } | null)?.name !== "AbortError") {
        options.onError?.(error);
      }
    } finally {
      inFlight = false;
      controller = null;
      // A refresh requested mid-flight runs now rather than being dropped.
      if (pendingForce) {
        pendingForce = false;
        void runTick(true);
      }
    }
  }

  function scheduleImmediate(): void {
    if (debounceHandle !== null) clearTimeoutFn(debounceHandle);
    debounceHandle = setTimeoutFn(() => {
      debounceHandle = null;
      if (isVisible()) void runTick(false);
    }, debounceMs);
  }

  const onWake = () => scheduleImmediate();

  return {
    start() {
      if (started) return;
      started = true;
      mark = new Date(now().getTime() - bootstrapLookbackMs);
      markIsFromServer = false;
      lastFetchAt = null;
      tickCount = 0;
      intervalHandle = setIntervalFn(() => {
        void runTick(false);
      }, intervalMs);
      addListener("visibilitychange", onWake);
      addListener("focus", onWake);
    },

    stop() {
      if (!started) return;
      started = false;
      if (intervalHandle !== null) clearIntervalFn(intervalHandle);
      if (debounceHandle !== null) clearTimeoutFn(debounceHandle);
      intervalHandle = null;
      debounceHandle = null;
      controller?.abort();
      pendingForce = false;
      removeListener("visibilitychange", onWake);
      removeListener("focus", onWake);
      // Subscribers are deliberately kept: stop()/start() must not leave an
      // existing subscriber deaf, which a reconnecting WebSocketSource needs.
      // Callers drop their listener with the function subscribe() returned.
    },

    refreshNow() {
      void runTick(true);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
