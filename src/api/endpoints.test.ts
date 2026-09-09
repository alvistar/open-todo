import { describe, expect, it, vi } from "vitest";
import { listProjects, listTasks, login } from "./endpoints";
import { createHttp } from "./http";
import type { Task } from "./types";

function pagedFetch(pages: unknown[][], totalPages?: number) {
  return vi.fn(async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (totalPages !== undefined)
      headers["x-pagination-total-pages"] = String(totalPages);
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200, headers });
  });
}

function makeHttp(fetchImpl: unknown) {
  return createHttp({
    getBaseUrl: () => "https://v.example",
    getToken: () => "tok",
    fetchImpl: fetchImpl as typeof fetch,
  });
}

const task = (id: number): Partial<Task> => ({ id, title: `t${id}`, done: false });

describe("pagination", () => {
  it("follows every page reported by the header", async () => {
    const first = Array.from({ length: 50 }, (_, i) => task(i + 1));
    const fetchImpl = pagedFetch([first, [task(51)]], 2);
    const projects = await listProjects(makeHttp(fetchImpl));

    expect(projects).toHaveLength(51);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[1]?.[0] as string).searchParams.get("page")).toBe(
      "2",
    );
  });

  it("stops on a short page when the server sends no page-count header", async () => {
    const fetchImpl = pagedFetch([[task(1), task(2)]]);
    const projects = await listProjects(makeHttp(fetchImpl));

    expect(projects).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks for Vikunja's maximum page size", async () => {
    const fetchImpl = pagedFetch([[task(1)]]);
    await listProjects(makeHttp(fetchImpl));
    expect(
      new URL(fetchImpl.mock.calls[0]?.[0] as string).searchParams.get("per_page"),
    ).toBe("50");
  });
});

describe("listTasks", () => {
  it("repeats sort_by/order_by and passes the verified query shape", async () => {
    const fetchImpl = pagedFetch([[task(1)]]);
    await listTasks(makeHttp(fetchImpl), {
      filter: "done = false && project = 1",
      sortBy: ["due_date", "id"],
      orderBy: ["asc", "asc"],
      includeNulls: true,
      timezone: "Europe/Rome",
    });

    const params = new URL(fetchImpl.mock.calls[0]?.[0] as string).searchParams;
    expect(params.get("filter")).toBe("done = false && project = 1");
    expect(params.getAll("sort_by")).toEqual(["due_date", "id"]);
    expect(params.getAll("order_by")).toEqual(["asc", "asc"]);
    expect(params.get("filter_include_nulls")).toBe("true");
    expect(params.get("filter_timezone")).toBe("Europe/Rome");
  });

  it("hits /tasks, not the removed /tasks/all", async () => {
    const fetchImpl = pagedFetch([[]]);
    await listTasks(makeHttp(fetchImpl));
    expect(new URL(fetchImpl.mock.calls[0]?.[0] as string).pathname).toBe(
      "/api/v1/tasks",
    );
  });
});

describe("login", () => {
  it("requests a long token by default and posts anonymously", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: "jwt" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await login(makeHttp(fetchImpl), { username: "a", password: "b" });

    expect(result.token).toBe("jwt");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      long_token: true,
      username: "a",
      password: "b",
    });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("passes a TOTP passcode through", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: "jwt" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    await login(makeHttp(fetchImpl), {
      username: "a",
      password: "b",
      totp_passcode: "123456",
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string).totp_passcode).toBe("123456");
  });
});
