/*
 * What a task write puts back into the cache.
 *
 * Only the part a review found wrong is pinned here: `updateTask` answers
 * through `POST /tasks/bulk`, which is not a view endpoint, so its copy carries
 * mapping §3's meaningless `position: 0` — the same 0 the incremental poll
 * produces and that `carryViewPosition` exists to refuse. Writing it into a
 * position-ordered list sends a renamed task to the top of an order somebody
 * arranged by hand.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
import { inboxView } from "../model/views";
import { queryKeys } from "./keys";
import { useUpdateTask } from "./useUpdateTask";

const updateTask = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints", () => ({
  updateTask,
  addLabel: vi.fn(),
  addSubtask: vi.fn(),
  createComment: vi.fn(),
  createLabel: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  removeLabel: vi.fn(),
  updateReminders: vi.fn(),
}));

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 7,
    title: "Water the plants",
    done: false,
    project_id: 3,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-14T00:00:00Z",
    ...over,
  }) as Task;

const view = inboxView(3, 5);

function setup(cached: Task[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.viewTasks(view.key), cached);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useUpdateTask(), { wrapper }),
    read: () => client.getQueryData<Task[]>(queryKeys.viewTasks(view.key)) ?? [],
  };
}

beforeEach(() => {
  updateTask.mockReset();
});

describe("writing a task back into a position-ordered list", () => {
  it("keeps the position the bulk response cannot know", async () => {
    const held = task({ position: 4096 });
    updateTask.mockResolvedValue(task({ title: "Water them well", position: 0 }));

    const { result, read } = setup([held]);
    act(() => {
      result.current.mutate({ task: held, values: { title: "Water them well" } });
    });

    await waitFor(() => expect(read()[0]?.title).toBe("Water them well"));
    expect(read()[0]?.position).toBe(4096);
  });

  it("still takes a real position when one comes back", async () => {
    // Not a blanket "ignore the server": a non-zero position is real and is
    // how a reorder made elsewhere would arrive.
    const held = task({ position: 4096 });
    updateTask.mockResolvedValue(task({ position: 8192 }));

    const { result, read } = setup([held]);
    act(() => {
      result.current.mutate({ task: held, values: { done: true } });
    });

    await waitFor(() => expect(read()[0]?.position).toBe(8192));
  });

  it("leaves a list it does not appear in alone", async () => {
    updateTask.mockResolvedValue(task({ title: "Renamed", position: 0 }));
    const other = task({ id: 99, position: 1 });

    const { result, read } = setup([other]);
    act(() => {
      result.current.mutate({ task: task({ position: 4096 }), values: { done: true } });
    });

    await waitFor(() => expect(updateTask).toHaveBeenCalled());
    expect(read()).toEqual([other]);
  });
});
