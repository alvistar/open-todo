import { describe, expect, it, vi } from "vitest";
import { addLabel, createTask } from "./endpoints";
import { createHttp } from "./http";

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
