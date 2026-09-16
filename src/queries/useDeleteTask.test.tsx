/*
 * Deleting a task, which is the one write in this app with no way back.
 *
 * Measured on `pinguino` (§6 item 31): `DELETE /tasks/{id}` answers 200, the
 * task then answers 404, and there is no restore route. So there is no Undo
 * here and there must not appear to be one — re-creating the task would make a
 * DIFFERENT task, with a new id and none of its comments, relations or
 * position, which is the invented value D-write and D-vocab both refuse.
 *
 * What is pinned is therefore the cache discipline: the row has to leave every
 * list it was in, at once, because unlike a completion there is nothing left on
 * the server for a refetch to find.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api/types";
import { queryKeys } from "./keys";
import { useDeleteTask } from "./useDeleteTask";

const deleteTask = vi.hoisted(() => vi.fn());
vi.mock("../api/endpoints", () => ({ deleteTask }));

const task = (id: number): Task =>
  ({
    id,
    title: `t${id}`,
    done: false,
    project_id: 3,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
  }) as Task;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.viewTasks("today"), [task(1), task(2)]);
  client.setQueryData(queryKeys.viewTasks("inbox:3"), [task(2), task(3)]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useDeleteTask(), { wrapper }),
    read: (key: string) => client.getQueryData<Task[]>(queryKeys.viewTasks(key)) ?? [],
  };
}

beforeEach(() => {
  deleteTask.mockReset();
  deleteTask.mockResolvedValue(undefined);
});

describe("deleting", () => {
  it("takes the row out of every list that held it", async () => {
    // Every list, not just the open one: a completion leaves a task the server
    // still has, so a refetch repairs a missed cache. A deletion does not.
    const { result, read } = setup();
    await act(async () => {
      await result.current.mutateAsync(task(2));
    });

    expect(read("today").map((t) => t.id)).toEqual([1]);
    expect(read("inbox:3").map((t) => t.id)).toEqual([3]);
  });

  it("leaves the lists alone when the server refuses", async () => {
    deleteTask.mockRejectedValue(new Error("nope"));
    const { result, read } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync(task(2))).rejects.toThrow("nope");
    });

    expect(read("today").map((t) => t.id)).toEqual([1, 2]);
  });

  it("asks the server before touching the cache", async () => {
    /*
     * Not optimistic, deliberately, unlike every other write here. An
     * optimistic delete that failed would have to put the row back — and the
     * row it put back would be the copy it happened to hold, which for the one
     * irreversible write is the wrong risk to take.
     */
    let release: (() => void) | undefined;
    deleteTask.mockImplementation(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const { result, read } = setup();

    act(() => {
      result.current.mutate(task(2));
    });
    await waitFor(() => expect(deleteTask).toHaveBeenCalled());
    expect(read("today").map((t) => t.id)).toEqual([1, 2]);

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(read("today").map((t) => t.id)).toEqual([1]));
  });
});
