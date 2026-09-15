import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
  it("marks it pending the moment it is clicked, before the server answers", () => {
    const { result } = setup();
    act(() => result.current.complete(task(), 2));

    expect(result.current.pending.get(91)?.kind).toBe("completed");
    expect(result.current.pending.get(91)?.index).toBe(2);
  });

  it("lets go after the linger, so the row finally leaves the view", async () => {
    const { result } = setup();
    act(() => result.current.complete(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINGER_MS + 1);
    });

    expect(result.current.pending.size).toBe(0);
  });

  it("ignores a second click while the first is in flight", async () => {
    const { result } = setup();
    act(() => result.current.complete(task(), 0));
    act(() => result.current.complete(task(), 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateTask).toHaveBeenCalledTimes(1);
  });
});

describe("undo", () => {
  it("writes done back to false and drops the row", async () => {
    const { result } = setup();
    act(() => result.current.complete(task(), 0));
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
    act(() => result.current.complete(task({ repeat_after: 86400 }), 0));
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
  it("is reported as advanced, with its next date, not as completed", async () => {
    // The server sets done back to false and moves the dates forward, so the
    // row must NOT disappear.
    updateTask.mockResolvedValue(
      task({ done: false, repeat_after: 86400, due_date: "2026-09-17T18:00:00Z" }),
    );
    const { result } = setup();
    act(() => result.current.complete(task({ repeat_after: 86400 }), 0));

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
    act(() => result.current.complete(task({ repeat_mode: 1 }), 0));

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
    act(() => result.current.complete(task(), 0));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending.get(91)?.kind).toBe("failed");
    expect(result.current.pending.get(91)?.message).toBe("Forbidden");
  });
});

describe("reset", () => {
  it("forgets everything, which is what navigating away must do", async () => {
    const { result } = setup();
    act(() => result.current.complete(task(), 0));
    act(() => result.current.reset());

    expect(result.current.pending.size).toBe(0);
  });
});
