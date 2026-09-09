import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
import type { LiveEvent } from "./LiveSource";
import { createPollingSource, type PollingSourceOptions } from "./PollingSource";

const task = (id: number, updated = "2026-09-09T10:00:00Z"): Task =>
  ({
    id,
    title: `t${id}`,
    done: false,
    project_id: 1,
    created: "2026-09-01T00:00:00Z",
    updated,
  }) as Task;

/** A harness with fake timers and fake page visibility. */
function harness(over: Partial<PollingSourceOptions> = {}) {
  let visible = true;
  let current: Task[] = [];
  const events: LiveEvent[] = [];
  const listeners = new Map<string, Set<() => void>>();

  const fetchSince = vi.fn(async (_since: Date) => [] as Task[]);
  const fetchAll = vi.fn(async () => current);

  const source = createPollingSource({
    fetchSince,
    fetchAll,
    getCurrent: () => current,
    now: () => new Date(Date.now()),
    isVisible: () => visible,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    ...over,
  });

  source.subscribe((event) => events.push(event));

  return {
    source,
    events,
    fetchSince,
    fetchAll,
    setVisible: (v: boolean) => {
      visible = v;
    },
    setCurrent: (tasks: Task[]) => {
      current = tasks;
    },
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

/** Advances fake timers and lets the awaited fetches settle. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
  return () => vi.useRealTimers();
});

describe("PollingSource", () => {
  it("does a full fetch on the first tick, then incremental ones", async () => {
    const h = harness();
    h.source.start();

    await advance(20_000);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
    expect(h.fetchSince).not.toHaveBeenCalled();

    await advance(20_000);
    expect(h.fetchSince).toHaveBeenCalledTimes(1);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
  });

  it("does a full fetch every fifth tick, where deletions become visible", async () => {
    const h = harness();
    h.source.start();
    await advance(20_000 * 6);
    expect(h.fetchAll).toHaveBeenCalledTimes(2);
    expect(h.fetchSince).toHaveBeenCalledTimes(4);
  });

  it("does not poll while the tab is hidden", async () => {
    const h = harness();
    h.source.start();
    h.setVisible(false);

    await advance(20_000 * 4);
    expect(h.fetchAll).not.toHaveBeenCalled();
    expect(h.fetchSince).not.toHaveBeenCalled();
  });

  it("polls again once the tab becomes visible", async () => {
    const h = harness();
    h.source.start();
    h.setVisible(false);
    await advance(20_000 * 3);
    expect(h.fetchAll).not.toHaveBeenCalled();

    h.setVisible(true);
    h.fire("visibilitychange");
    await advance(400);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of focus events into one request", async () => {
    const h = harness();
    h.source.start();
    h.fire("focus");
    h.fire("focus");
    h.fire("visibilitychange");
    await advance(400);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
  });

  it("emits upserts from the incremental fetch", async () => {
    const h = harness();
    h.source.start();
    await advance(20_000); // full

    h.fetchSince.mockResolvedValueOnce([task(7)]);
    await advance(20_000);

    expect(h.events.at(-1)).toEqual({ type: "upsert", tasks: [task(7)] });
  });

  it("emits nothing when the incremental fetch is empty", async () => {
    const h = harness();
    h.source.start();
    await advance(20_000);
    const before = h.events.length;
    await advance(20_000);
    expect(h.events.length).toBe(before);
  });

  it("carries exactly the missing ids on a deletion", async () => {
    const h = harness();
    h.setCurrent([task(1), task(2), task(3)]);
    h.source.start();

    h.fetchAll.mockResolvedValueOnce([task(1), task(3)]);
    await advance(20_000);

    const deletes = h.events.filter((e) => e.type === "delete");
    expect(deletes).toEqual([{ type: "delete", ids: [2] }]);
  });

  it("emits no delete event when nothing disappeared", async () => {
    const h = harness();
    h.setCurrent([task(1)]);
    h.source.start();
    await advance(20_000);
    expect(h.events.some((e) => e.type === "delete")).toBe(false);
  });

  it("derives the mark from the newest SERVER timestamp, not the browser clock", async () => {
    const h = harness();
    h.source.start();
    h.fetchAll.mockResolvedValueOnce([task(1, "2026-09-09T11:30:00Z")]);
    await advance(20_000); // full fetch
    await advance(20_000); // incremental

    const since = h.fetchSince.mock.calls[0]?.[0] as Date;
    // 11:30:00 is the newest `updated` the server reported, minus the 2s
    // overlap - NOT the browser's 12:00:xx.
    expect(since.toISOString()).toBe("2026-09-09T11:29:58.000Z");
  });

  it("keeps polling correctly when the browser clock is far ahead of the server", async () => {
    // A browser an hour fast used to kill incremental polling outright: every
    // request asked for changes in the future and returned nothing, forever.
    vi.setSystemTime(new Date("2026-09-09T13:00:00Z")); // an hour ahead
    const h = harness();
    h.source.start();
    h.fetchAll.mockResolvedValueOnce([task(1, "2026-09-09T12:00:00Z")]);
    await advance(20_000);
    await advance(20_000);

    const since = h.fetchSince.mock.calls[0]?.[0] as Date;
    expect(since.toISOString()).toBe("2026-09-09T11:59:58.000Z");
    // The window must not be in the future relative to real server time.
    expect(since.getTime()).toBeLessThan(Date.parse("2026-09-09T12:00:01Z"));
  });

  it("does not advance the mark past the newest timestamp the server reported", async () => {
    // A task edited while the page walk was in progress must be re-read, so
    // the mark may not jump to "now".
    const h = harness();
    h.source.start();
    h.fetchAll.mockResolvedValueOnce([task(1, "2026-09-09T12:00:05Z")]);
    await advance(20_000);
    await advance(20_000);
    const first = h.fetchSince.mock.calls[0]?.[0] as Date;

    // An incremental tick that returns nothing must NOT push the mark forward.
    await advance(20_000);
    const second = h.fetchSince.mock.calls[1]?.[0] as Date;
    expect(second.toISOString()).toBe(first.toISOString());
  });

  it("falls back to a bounded lookback before any server timestamp is known", async () => {
    const h = harness();
    h.source.start();
    h.fetchAll.mockResolvedValueOnce([]); // empty view: no server timestamp
    await advance(20_000);
    await advance(20_000);

    const since = h.fetchSince.mock.calls[0]?.[0] as Date;
    // start() at 12:00:00 minus the 60s bootstrap lookback, minus 2s overlap.
    expect(since.toISOString()).toBe("2026-09-09T11:58:58.000Z");
  });

  it("refreshNow forces a full fetch even when hidden", async () => {
    const h = harness();
    h.source.start();
    h.setVisible(false);
    h.source.refreshNow();
    await advance(10);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
  });

  it("never runs two requests at once", async () => {
    const releases: Array<() => void> = [];
    const slow = vi.fn(
      () =>
        new Promise<Task[]>((resolve) => {
          releases.push(() => resolve([]));
        }),
    );
    const h = harness({ fetchAll: slow });
    h.source.start();

    await advance(20_000);
    await advance(20_000);
    await advance(20_000);
    expect(slow).toHaveBeenCalledTimes(1);

    releases[0]?.();
  });

  it("stops polling and detaches its listeners", async () => {
    const h = harness();
    h.source.start();
    await advance(20_000);
    h.source.stop();

    await advance(20_000 * 3);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);

    h.fire("focus");
    await advance(400);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
  });

  it("reports a failed fetch and retries the full slot rather than losing it", async () => {
    const onError = vi.fn();
    const h = harness({ onError });
    h.source.start();

    h.fetchAll.mockRejectedValueOnce(new Error("offline"));
    await advance(20_000);
    expect(onError).toHaveBeenCalledTimes(1);

    // A full fetch is the only thing that detects deletions, so the next tick
    // retries it instead of waiting another five ticks.
    await advance(20_000);
    expect(h.fetchAll).toHaveBeenCalledTimes(2);
    expect(h.fetchSince).not.toHaveBeenCalled();
  });

  it("runs a refreshNow that arrived while a tick was in flight", async () => {
    // D4 slice 1 refreshes straight after its own mutation; if that lands
    // during a periodic tick it must not be silently dropped.
    const gate: Array<() => void> = [];
    const slowAll = vi.fn(
      () =>
        new Promise<Task[]>((resolve) => {
          gate.push(() => resolve([]));
        }),
    );
    const h = harness({ fetchAll: slowAll });
    h.source.start();

    await advance(20_000);
    expect(slowAll).toHaveBeenCalledTimes(1);

    h.source.refreshNow(); // dropped by the old single-flight guard
    gate[0]?.();
    await advance(10);

    expect(slowAll).toHaveBeenCalledTimes(2);
    gate[1]?.();
  });

  it("keeps subscribers across stop() and start()", async () => {
    const h = harness();
    h.source.start();
    await advance(20_000);
    const seen = h.events.length;

    h.source.stop();
    h.source.start();
    await advance(20_000);

    expect(h.events.length).toBeGreaterThan(seen);
  });

  it("start and stop are idempotent", async () => {
    const h = harness();
    h.source.start();
    h.source.start();
    await advance(20_000);
    expect(h.fetchAll).toHaveBeenCalledTimes(1);
    h.source.stop();
    expect(() => h.source.stop()).not.toThrow();
  });
});
