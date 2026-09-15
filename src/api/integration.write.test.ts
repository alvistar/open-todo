/*
 * Integration test against a real Vikunja instance that WRITES.
 *
 * Deliberately a separate file from integration.test.ts, whose read-only
 * promise is what makes it safe to run without thinking about it. This one
 * needs a third variable on top of the other two, so it cannot run by accident:
 *
 *   VIKUNJA_TEST_URL=https://vikunja.example \
 *   VIKUNJA_TEST_TOKEN=tk_... \
 *   VIKUNJA_TEST_WRITE=1 \
 *   pnpm test src/api/integration.write.test.ts
 *
 * What it is for (D-write): `POST /tasks/{id}` re-applies every omitted field
 * as its zero value, so a one-field write there erases the rest of the task.
 * `updateTask` avoids that by going through the bulk endpoint's `fields` list,
 * and echoes reminders and assignees because those two are handled OUTSIDE
 * that guard. All of that is read off Vikunja's source at v2.5.0 - this test is
 * what turns it from a reading into a measurement, and what will notice when a
 * future server changes its mind.
 *
 * It cleans up after itself: every task it creates is deleted at the end.
 */
import { afterAll, describe, expect, it } from "vitest";
import { deleteTask, getUser, updateTask } from "./endpoints";
import { createHttp } from "./http";
import type { Task } from "./types";

declare const process: { env: Record<string, string | undefined> };

const baseUrl = process.env.VIKUNJA_TEST_URL;
const token = process.env.VIKUNJA_TEST_TOKEN;
const enabled = Boolean(baseUrl && token && process.env.VIKUNJA_TEST_WRITE === "1");

const http = createHttp({
  getBaseUrl: () => baseUrl ?? null,
  getToken: () => token ?? null,
});

/** Every task this file creates, so none of it is left behind. */
const created: number[] = [];

async function scratchProjectId(): Promise<number> {
  const user = await getUser(http);
  const id = user.settings?.default_project_id;
  if (!id) throw new Error("The test user has no default_project_id to write to.");
  return id;
}

/**
 * A task carrying one of everything a completion could erase.
 *
 * Created directly rather than through `createTask`, which only writes what the
 * quick-add grammar produces - a reminder is not in it. The assignee goes on
 * afterwards through its own sub-resource, the only way to set one.
 */
async function scratchTask(
  name: string,
  extra: Record<string, unknown>,
): Promise<{ task: Task; due: string }> {
  const projectId = await scratchProjectId();
  const due = new Date(Date.now() + 86_400_000).toISOString();

  const fresh = await http.request<Task>(`/projects/${projectId}/tasks`, {
    method: "PUT",
    body: {
      title: `open-todo write test: ${name}`,
      description: "<p>Kept, not wiped.</p>",
      due_date: due,
      priority: 3,
      percent_done: 0.5,
      reminders: [{ relative_period: -3600, relative_to: "due_date" }],
      ...extra,
    },
  });
  created.push(fresh.id);

  const user = await getUser(http);
  await http.request(`/tasks/${fresh.id}/assignees`, {
    method: "PUT",
    body: { user_id: user.id },
  });

  // Re-read, because the create response predates the assignee and because
  // updateTask's contract is that it is handed a copy the SERVER produced.
  const task = await http.request<Task>(`/tasks/${fresh.id}`);
  expect(task.reminders?.length).toBe(1);
  expect(task.assignees?.length).toBe(1);
  return { task, due };
}

const seconds = (iso: string | null | undefined) =>
  iso ? Math.round(Date.parse(iso) / 1000) : 0;

afterAll(async () => {
  if (!enabled) return;
  for (const id of created) {
    try {
      await deleteTask(http, id);
    } catch {
      // Reported rather than thrown: a failed cleanup must not turn a passing
      // run red, but it does leave something behind, so say so.
      console.warn(`  could not delete scratch task ${id}`);
    }
  }
});

describe.skipIf(!enabled)("live Vikunja instance (writes)", () => {
  it("completing a task leaves the rest of it alone", { timeout: 30_000 }, async () => {
    const { task, due } = await scratchTask("plain", {});

    const done = await updateTask(http, task, { done: true });

    expect(done.done).toBe(true);
    // Every column the single-task route would have zeroed.
    expect(done.description).toContain("Kept, not wiped.");
    expect(seconds(done.due_date)).toBe(seconds(due));
    expect(done.priority).toBe(3);
    // The two the `fields` guard does NOT cover, which updateTask echoes back.
    expect(done.reminders?.length).toBe(1);
    expect(done.assignees?.length).toBe(1);

    const reopened = await updateTask(http, done, { done: false });
    expect(reopened.done).toBe(false);
    expect(reopened.reminders?.length).toBe(1);
    expect(reopened.assignees?.length).toBe(1);
  });

  it("completing a repeating task advances it and keeps everything else", {
    timeout: 30_000,
  }, async () => {
    /*
     * The combination D-write exists to protect, and the one the first cut of
     * this test missed by splitting it in two. A repeat is stored as two
     * ordinary columns, repeat_after and repeat_mode, so it is erased by the
     * same mechanism that erases the description - and losing it means the
     * task repeats once and then silently stops.
     */
    const { task, due } = await scratchTask("repeating", { repeat_after: 86_400 });

    const after = await updateTask(http, task, { done: true });

    // updateDone runs the repeat_mode handler, which puts done back to false
    // and moves the dates on by exactly one interval.
    expect(after.done).toBe(false);
    expect(seconds(after.due_date)).toBe(seconds(due) + 86_400);
    expect(after.repeat_after).toBe(86_400);
    expect(after.description).toContain("Kept, not wiped.");
    expect(after.priority).toBe(3);
    expect(after.reminders?.length).toBe(1);
    expect(after.assignees?.length).toBe(1);
  });
});
