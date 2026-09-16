/*
 * The transient message channel D4 step 4 asks for.
 *
 * It exists for what has nowhere else to land. The nine inline `role="status"`
 * messages in this app are NOT candidates: D-detail put each of them beside the
 * field it belongs to on purpose, because a failed write must not take what you
 * typed out of sight. A toast is for the opposite case — a write that succeeded
 * and took its row off the screen, or one that failed with no row left to say
 * so on.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_MS, INFO_MS, useToasts } from "./useToasts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("showing", () => {
  it("shows a message and takes it away again", async () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.show({ message: "Moved to Lavoro" });
    });
    expect(result.current.toasts.map((t) => t.message)).toEqual(["Moved to Lavoro"]);

    await act(() => vi.advanceTimersByTimeAsync(INFO_MS));
    expect(result.current.toasts).toEqual([]);
  });

  it("keeps a failure on screen longer than a success", async () => {
    // The same reasoning D-write wrote down for the row messages: a failure has
    // to be READ, a confirmation only noticed.
    expect(ERROR_MS).toBeGreaterThan(INFO_MS);
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.show({ message: "Not moved: nope", kind: "error" });
    });
    await act(() => vi.advanceTimersByTimeAsync(INFO_MS));
    expect(result.current.toasts).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(ERROR_MS - INFO_MS));
    expect(result.current.toasts).toEqual([]);
  });

  it("stacks several, newest last, each on its own clock", async () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.show({ message: "first" });
    });
    await act(() => vi.advanceTimersByTimeAsync(INFO_MS / 2));
    act(() => {
      result.current.show({ message: "second" });
    });

    expect(result.current.toasts.map((t) => t.message)).toEqual(["first", "second"]);

    await act(() => vi.advanceTimersByTimeAsync(INFO_MS / 2));
    expect(result.current.toasts.map((t) => t.message)).toEqual(["second"]);
  });

  it("gives each one an id of its own, even for the same message", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.show({ message: "same" });
      result.current.show({ message: "same" });
    });
    const [a, b] = result.current.toasts;
    expect(a?.id).not.toBe(b?.id);
  });
});

describe("dismissing", () => {
  it("can be dismissed before its time", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.show({ message: "gone" });
    });
    const id = result.current.toasts[0]?.id as number;

    act(() => {
      result.current.dismiss(id);
    });
    expect(result.current.toasts).toEqual([]);
  });

  it("does not come back after being dismissed", async () => {
    // The timer has to be cleared, not merely ignored: a surviving one would
    // fire into a list that no longer holds the toast and drop whatever had
    // taken its place.
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.show({ message: "one" });
    });
    const id = result.current.toasts[0]?.id as number;
    act(() => {
      result.current.dismiss(id);
      result.current.show({ message: "two" });
    });

    await act(() => vi.advanceTimersByTimeAsync(INFO_MS - 1));
    expect(result.current.toasts.map((t) => t.message)).toEqual(["two"]);
  });
});

describe("an action", () => {
  it("runs it and takes the toast away", async () => {
    const run = vi.fn();
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.show({ message: "Moved", action: { label: "Undo", run } });
    });

    await act(async () => {
      await result.current.toasts[0]?.action?.run();
    });
    act(() => {
      result.current.dismiss(result.current.toasts[0]?.id as number);
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.toasts).toEqual([]);
  });
});

describe("unmounting", () => {
  it("clears its timers", async () => {
    // Otherwise a timer fires setState on a hook that is gone. The repo has
    // been here before (§7 item 9) - and note the fix there LATCHED and killed
    // the feature in dev, so this one must not use a one-way flag.
    const { result, unmount } = renderHook(() => useToasts());
    act(() => {
      result.current.show({ message: "orphan" });
    });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(INFO_MS * 2));
    expect(vi.getTimerCount()).toBe(0);
  });
});
