/*
 * Moving a task within a view's order.
 *
 * What is worth pinning here is not the arithmetic — position.ts owns that —
 * but the cache discipline around it: the list must move under the hand
 * immediately, come back if the write fails, and never be invalidated, because
 * a refetch landing before the server has the new position shows the old order
 * and reads as the drag being rejected.
 *
 * What this file CANNOT catch, and the repo has been bitten by before (§7 item
 * 9): anything that only goes wrong under StrictMode's double mount, or when a
 * real 20 s poll tick lands mid-write. Drive the app.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
import { inboxView } from "../model/views";
import { queryKeys } from "./keys";
import { useReorderTask } from "./useReorderTask";

const setTaskPosition = vi.hoisted(() => vi.fn());
const listViewTasks = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints", () => ({ setTaskPosition, listViewTasks }));

const task = (id: number, position: number): Task =>
  ({
    id,
    title: `t${id}`,
    done: false,
    project_id: 7,
    position,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
  }) as Task;

const view = inboxView(7, 5);

function setup(tasks: Task[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.viewTasks(view.key), tasks);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useReorderTask(view), { wrapper });
  const read = () => client.getQueryData<Task[]>(queryKeys.viewTasks(view.key)) ?? [];
  return { ...rendered, client, read };
}

beforeEach(() => {
  setTaskPosition.mockReset();
  setTaskPosition.mockResolvedValue({});
  listViewTasks.mockReset();
});

describe("reordering", () => {
  const three = [task(1, 10), task(2, 20), task(3, 30)];

  it("moves the row before the server has answered", async () => {
    const { result, read } = setup(three);
    let resolve: (() => void) | undefined;
    setTaskPosition.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );

    act(() => {
      result.current.reorder(3, 1);
    });

    expect(read().map((t) => t.id)).toEqual([3, 1, 2]);
    // The optimistic copy carries the computed position too. Without it the
    // array order and the comparator disagree, and the next merge re-sorts
    // the row straight back to where it was dragged from.
    expect(read()[0]?.position).toBe(5);
    act(() => resolve?.());
  });

  it("writes the move to the view the order lives in", async () => {
    const { result } = setup(three);
    act(() => {
      result.current.reorder(1, 2);
    });
    await waitFor(() => expect(setTaskPosition).toHaveBeenCalled());
    expect(setTaskPosition.mock.calls[0]?.slice(1)).toEqual([1, 5, 25]);
  });

  it("puts the list back when the write fails, and says why", async () => {
    setTaskPosition.mockRejectedValue(new Error("Nope"));
    const { result, read } = setup(three);

    act(() => {
      result.current.reorder(1, 3);
    });
    await waitFor(() => expect(result.current.error).toBe("Not moved: Nope"));
    expect(read().map((t) => t.id)).toEqual([1, 2, 3]);
    expect(read().map((t) => t.position)).toEqual([10, 20, 30]);
  });

  it("does nothing at all for a move that goes nowhere", () => {
    const { result } = setup(three);
    act(() => {
      result.current.reorder(2, 2);
    });
    expect(setTaskPosition).not.toHaveBeenCalled();
  });

  it("refuses to move a task it has never placed", () => {
    // Its position was dropped by the poll because a flat GET cannot express
    // one (§3). There is no honest number to send for it.
    const { result } = setup([task(1, 10), { ...task(2, 0), position: undefined }]);
    act(() => {
      result.current.reorder(2, 1);
    });
    expect(setTaskPosition).not.toHaveBeenCalled();
  });
});

describe("when the gaps run out", () => {
  // §6 item 23: nothing on the server renumbers, so the client has to, or the
  // halving continues until two tasks share a float and order falls back to id.
  const crowded = [task(1, 10), task(2, 10.001), task(3, 30)];

  it("renumbers the whole view after a crowded write", async () => {
    listViewTasks.mockResolvedValue([task(1, 65536), task(3, 131072), task(2, 196608)]);
    const { result, read } = setup(crowded);

    act(() => {
      result.current.reorder(3, 2);
    });

    await waitFor(() => expect(setTaskPosition).toHaveBeenCalledTimes(4));
    // One write for the move, then one per task to spread them out again.
    const spread = setTaskPosition.mock.calls.slice(1).map((c) => c[3]);
    expect(spread).toEqual([65536, 131072, 196608]);
    // And the view is re-read, because the positions we just wrote are the
    // authority and the optimistic copies are not.
    await waitFor(() => expect(read().map((t) => t.id)).toEqual([1, 3, 2]));
  });

  it("does not renumber when there is still room", async () => {
    const { result } = setup([task(1, 10), task(2, 20), task(3, 30)]);
    act(() => {
      result.current.reorder(1, 2);
    });
    await waitFor(() => expect(setTaskPosition).toHaveBeenCalledTimes(1));
    expect(listViewTasks).not.toHaveBeenCalled();
  });
});

describe("a view with no order to write to", () => {
  it("reports itself as not reorderable and writes nothing", () => {
    const flat = inboxView(7);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.viewTasks(flat.key), [task(1, 0), task(2, 0)]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReorderTask(flat), { wrapper });

    expect(result.current.reorderable).toBe(false);
    act(() => {
      result.current.reorder(1, 2);
    });
    expect(setTaskPosition).not.toHaveBeenCalled();
  });
});
