import { describe, expect, it, vi } from "vitest";
import { addLabel, createTask, deleteTask, updateTask } from "./endpoints";
import { createHttp } from "./http";
import type { Task } from "./types";

function makeHttp(fetchImpl: unknown) {
  return createHttp({
    getBaseUrl: () => "https://v.example",
    getToken: () => "tok",
    fetchImpl: fetchImpl as typeof fetch,
  });
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("createTask", () => {
  it("uses PUT on the project's task collection, which is Vikunja's create verb", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      ok({ id: 91, title: "Call the accountant" }),
    );
    const task = await createTask(makeHttp(fetchImpl), 3, {
      title: "Call the accountant",
      due_date: "2026-09-10T08:00:00Z",
      priority: 4,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://v.example/api/v1/projects/3/tasks");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Call the accountant",
      due_date: "2026-09-10T08:00:00Z",
      priority: 4,
    });
    expect(task.id).toBe(91);
  });

  it("omits fields the parser did not set, rather than sending zeroes", async () => {
    // Sending priority: 0 would overwrite a priority the user never mentioned.
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ok({ id: 1 }));
    await createTask(makeHttp(fetchImpl), 1, { title: "Plain" });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: "Plain" });
  });
});

describe("addLabel", () => {
  it("PUTs the label id onto the task's label sub-resource", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ok({}));
    await addLabel(makeHttp(fetchImpl), 91, 10);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://v.example/api/v1/tasks/91/labels");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ label_id: 10 });
  });
});

/** A task as the list endpoint hands it over, with both sub-resources set. */
function storedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 91,
    title: "Water the plants",
    done: false,
    project_id: 3,
    due_date: "2026-09-16T18:00:00Z",
    priority: 3,
    repeat_after: 86400,
    reminders: [{ relative_period: -3600, relative_to: "due_date" }],
    assignees: [{ id: 7, username: "alvistar" }],
    created: "2026-09-01T10:00:00Z",
    updated: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

const bulkOk = (tasks: unknown[]) =>
  ok({ task_ids: [91], fields: ["done"], values: {}, tasks });

describe("updateTask", () => {
  it("writes through the bulk endpoint, naming only the fields it sets", async () => {
    // D-write: POST /tasks/{id} re-applies every omitted field as its zero
    // value, so a one-field write there erases the rest of the task. The bulk
    // endpoint is the only v1 path that reaches Vikunja's `fields` branch,
    // where unnamed columns are re-read from the stored row instead.
    const fetchImpl = vi.fn(async () => bulkOk([storedTask({ done: true })]));

    await updateTask(makeHttp(fetchImpl), storedTask(), { done: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://v.example/api/v1/tasks/bulk");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.task_ids).toEqual([91]);
    expect(body.fields).toEqual(["done"]);
    expect(body.values.done).toBe(true);
  });

  it("echoes reminders and assignees, which the fields branch does NOT protect", async () => {
    // updateTaskAssignees and updateReminders run outside the `fields` guard
    // (tasks.go:1278 and :1475 at v2.5.0): an absent list is read as "the user
    // removed them all" and the server deletes the lot.
    const fetchImpl = vi.fn(async () => bulkOk([storedTask({ done: true })]));

    await updateTask(makeHttp(fetchImpl), storedTask(), { done: true });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.values.reminders).toEqual([
      { relative_period: -3600, relative_to: "due_date" },
    ]);
    expect(body.values.assignees).toEqual([{ id: 7, username: "alvistar" }]);
  });

  it("sends empty lists when the task has neither, not undefined", async () => {
    const fetchImpl = vi.fn(async () => bulkOk([storedTask()]));
    const bare = storedTask();
    bare.reminders = null;
    bare.assignees = null;

    await updateTask(makeHttp(fetchImpl), bare, { done: true });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.values.reminders).toEqual([]);
    expect(body.values.assignees).toEqual([]);
  });

  it("names every field it was given", async () => {
    const fetchImpl = vi.fn(async () => bulkOk([storedTask()]));
    await updateTask(makeHttp(fetchImpl), storedTask(), {
      done: false,
      due_date: "2026-09-20T18:00:00Z",
    });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.fields.sort()).toEqual(["done", "due_date"]);
    expect(body.values.due_date).toBe("2026-09-20T18:00:00Z");
  });

  it("returns the updated task the server sends back", async () => {
    // Completing a RECURRING task returns done:false with an advanced due_date
    // (updateDone -> setTaskDates*), which is the only cheap way to learn the
    // next occurrence.
    const advanced = storedTask({ done: false, due_date: "2026-09-17T18:00:00Z" });
    const fetchImpl = vi.fn(async () => bulkOk([advanced]));

    const result = await updateTask(makeHttp(fetchImpl), storedTask(), { done: true });

    expect(result.due_date).toBe("2026-09-17T18:00:00Z");
    expect(result.done).toBe(false);
  });

  it("accepts a bare array response as well as the documented envelope", async () => {
    // The handler returns the BulkTask struct (tasks inside), while its own
    // swagger annotation promises {array} models.Task. Tolerate both rather
    // than depend on which one a given build honours.
    const fetchImpl = vi.fn(async () => ok([storedTask({ done: true })]));
    const result = await updateTask(makeHttp(fetchImpl), storedTask(), { done: true });
    expect(result.done).toBe(true);
  });

  it("fails loudly when the response carries no task", async () => {
    const fetchImpl = vi.fn(async () => ok({ tasks: [] }));
    await expect(
      updateTask(makeHttp(fetchImpl), storedTask(), { done: true }),
    ).rejects.toThrow(/did not return/i);
  });
});

describe("deleteTask", () => {
  it("DELETEs the task", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await deleteTask(makeHttp(fetchImpl), 91);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://v.example/api/v1/tasks/91");
    expect(init.method).toBe("DELETE");
  });
});
