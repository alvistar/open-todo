import type { Task } from "../api/types";
import type { LiveEvent, LiveSource } from "./LiveSource";
import { diffDeleted, latestUpdated } from "./reconcile";

export interface PollingSourceOptions {
  /** Incremental fetch: tasks whose `updated` is at or after `since`. */
  fetchSince: (since: Date, signal?: AbortSignal) => Promise<Task[]>;
  /** Full fetch of the open view, used to find deletions. */
  fetchAll: (signal?: AbortSignal) => Promise<Task[]>;
  /** What the view currently holds, for the id-set diff. */
  getCurrent: () => Task[];

  intervalMs?: number;
  /** Do a full fetch every Nth tick; deletions are only visible there. */
  fullFetchEvery?: number;
  /** Re-ask slightly before the last mark, to cover clock skew. */
  overlapMs?: number;
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
  let mark = now();
  let tickCount = 0;
  let inFlight = false;

  function emit(event: LiveEvent): void {
    for (const listener of listeners) listener(event);
  }

  async function runTick(force: boolean): Promise<void> {
    if (!force && !isVisible()) return;
    // One request at a time: a slow server must not queue ticks up behind it.
    if (inFlight) return;

    inFlight = true;
    controller = new AbortController();
    const startedAt = now();
    const full = force || tickCount % fullFetchEvery === 0;
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
        const since = new Date(mark.getTime() - overlapMs);
        fetched = await options.fetchSince(since, controller.signal);
        if (fetched.length > 0) emit({ type: "upsert", tasks: fetched });
      }
      // Advance the mark from the newest timestamp actually returned, else to
      // when the request *started* — anything written while it was in flight
      // is then re-read next tick, which is what overlapMs also guards.
      const newest = latestUpdated(fetched);
      mark = newest && newest > startedAt ? newest : startedAt;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        options.onError?.(error);
      }
    } finally {
      inFlight = false;
      controller = null;
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
      mark = now();
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
      removeListener("visibilitychange", onWake);
      removeListener("focus", onWake);
      listeners.clear();
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
