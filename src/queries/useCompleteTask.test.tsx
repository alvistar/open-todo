import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
import { getDraftSummary } from "../lifecycle/drafts";
import { LINGER_MS, useCompleteTask } from "./useCompleteTask";

const updateTask = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints", () => ({ updateTask }));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 91,
    title: "Water the plants",
    done: false,
    project_id: 3,
    created: "2026-09-01T10:00:00Z",
    updated: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  /*
   * StrictMode on purpose, matching main.tsx - but be warned: it does NOT
   * reproduce the bug it was added for. The `live` flag stayed latched after
   * StrictMode's remount and the linger never appeared in `pnpm dev`; this
   * wrapper still passes with the fix reverted, measured 2026-09-15. The
   * mount/cleanup/mount sequence under renderHook does not leave the ref in
   * the state the real root does. Only driving the app caught it, and only
   * driving the app will catch the next one of its kind.
   */
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return renderHook(
    () => useCompleteTask({ timeZone: "Europe/Rome", defaultDueTime: null }),
    { wrapper },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  updateTask.mockReset();
  updateTask.mockImplementation(async (_http, t: Task, values: { done: boolean }) => ({
    ...t,
    done: values.done,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("completing a plain task", () => {
  it("reports a completion write as pending until the server answers", async () => {
    updateTask.mockImplementation(() => new Promise<Task>(() => {}));
    const { result, unmount } = setup();
    act(() => result.current.toggle(task(), 2));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getDraftSummary().pending).toBe(true);
    unmount();
    expect(getDraftSummary().pending).toBe(false);
  });

  it("marks it pending the moment it is clicked, before the server answers", () => {
    const { result } = setup();
    act(() => result.current.toggle(task(), 2));

    expect(result.current.pending.get(91)?.kind).toBe("completed");
    expect(result.current.pending.get(91)?.index).toBe(2);
  });

  it("lets go after the linger, so the row finally leaves the view", async () => {
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINGER_MS + 1);
    });

    expect(result.current.pending.size).toBe(0);
  });

  it("ignores a second click while the first is on the wire", async () => {
    // Without the in-flight guard this would complete and then immediately
    // undo, because the row is already drawn as done by the first click.
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));
    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(result.current.pending.get(91)?.kind).toBe("completed");
  });

  it("takes the completion back when the settled row is clicked again", async () => {
    // The row says "Reopen" once it is drawn as done, and the checkbox has to
    // honour its own label - the Undo text is not the only way back.
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.toggle(task(), 0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateTask).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      done: false,
    });
    expect(result.current.pending.size).toBe(0);
  });
});

describe("undo", () => {
  it("writes done back to false and drops the row", async () => {
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.undo(91);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateTask).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      done: false,
    });
    expect(result.current.pending.size).toBe(0);
  });

  it("does nothing for a repeating task, whose old due date is gone", async () => {
    updateTask.mockResolvedValue(
      task({ done: false, repeat_after: 86400, due_date: "2026-09-17T18:00:00Z" }),
    );
    const { result } = setup();
    act(() => result.current.toggle(task({ repeat_after: 86400 }), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsBefore = updateTask.mock.calls.length;
    act(() => result.current.undo(91));

    expect(updateTask).toHaveBeenCalledTimes(callsBefore);
    expect(result.current.pending.get(91)?.kind).toBe("advanced");
  });
});

describe("a repeating task", () => {
  it("is never drawn as completed, not even during the round trip", async () => {
    // The server will advance it, not complete it. Striking it through would
    // be a lie, and the Undo that comes with a completed row would offer to
    // restore a date that no longer exists anywhere.
    const { result } = setup();
    act(() => result.current.toggle(task({ repeat_after: 86400 }), 0));

    expect(result.current.pending.get(91)?.kind).toBe("advanced");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it("is reported as advanced, with its next date, not as completed", async () => {
    // The server sets done back to false and moves the dates forward, so the
    // row must NOT disappear.
    updateTask.mockResolvedValue(
      task({ done: false, repeat_after: 86400, due_date: "2026-09-17T18:00:00Z" }),
    );
    const { result } = setup();
    act(() => result.current.toggle(task({ repeat_after: 86400 }), 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending.get(91)?.kind).toBe("advanced");
    expect(result.current.pending.get(91)?.message).toMatch(/^Done\. Next: /);
  });

  it("counts repeat_mode 1 as repeating even with no interval", async () => {
    // The monthly mode ignores repeat_after; a task can repeat with zero.
    updateTask.mockResolvedValue(task({ done: false, repeat_mode: 1 }));
    const { result } = setup();
    act(() => result.current.toggle(task({ repeat_mode: 1 }), 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending.get(91)?.kind).toBe("advanced");
  });
});

describe("when the write fails", () => {
  it("puts the row back and says why", async () => {
    updateTask.mockRejectedValue(new Error("Forbidden"));
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending.get(91)?.kind).toBe("failed");
    // Prefixed, because the server's own message ("Forbidden") lands on the
    // row on its own and reads as a label rather than as something failing.
    expect(result.current.pending.get(91)?.message).toBe("Not saved: Forbidden");
  });
});

describe("retrying after a failure", () => {
  it("goes again on the next click instead of being swallowed", async () => {
    updateTask.mockRejectedValueOnce(new Error("Forbidden"));
    const { result } = setup();

    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.pending.get(91)?.kind).toBe("failed");

    act(() => result.current.toggle(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(result.current.pending.get(91)?.kind).toBe("completed");
  });
});

describe("reset", () => {
  it("forgets everything, which is what navigating away must do", async () => {
    const { result } = setup();
    act(() => result.current.toggle(task(), 0));
    act(() => result.current.reset());

    expect(result.current.pending.size).toBe(0);
  });
});
