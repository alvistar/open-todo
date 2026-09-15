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
import {
  deleteTask,
  getUser,
  listProjects,
  updateReminders,
  updateTask,
} from "./endpoints";
import { createHttp } from "./http";
import { type Task, VIKUNJA_NULL_DATE } from "./types";

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
  // Zeroed milliseconds: Vikunja stores the second, so a due date carrying
  // .649 comes back as .000 and an exact comparison fails on noise.
  const dueAt = new Date(Date.now() + 86_400_000);
  dueAt.setMilliseconds(0);
  const due = dueAt.toISOString();

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
  iso ? Math.floor(Date.parse(iso) / 1000) : 0;

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

  it("the sidebar's writes change one column and erase nothing", {
    timeout: 30_000,
  }, async () => {
    /*
     * Step 3 of the detail dialog writes three columns through this same
     * endpoint, and two of them carry a claim this test is here to settle:
     * that the bulk route accepts a project MOVE at all, and that Vikunja
     * reads the year-1 date as "unset" rather than storing it as a real date
     * in the year 1. Both are cheap to assert and expensive to be wrong about.
     */
    const { task, due } = await scratchTask("sidebar", {});

    const prioritised = await updateTask(http, task, { priority: 4 });
    expect(prioritised.priority).toBe(4);
    expect(seconds(prioritised.due_date)).toBe(seconds(due));
    expect(prioritised.reminders?.length).toBe(1);
    expect(prioritised.assignees?.length).toBe(1);

    const elsewhere = (await listProjects(http)).find(
      (project) => project.id !== task.project_id && !project.is_archived,
    );
    if (!elsewhere) {
      throw new Error("This test needs a second, unarchived project to move a task to.");
    }
    const moved = await updateTask(http, prioritised, { project_id: elsewhere.id });
    expect(moved.project_id).toBe(elsewhere.id);
    expect(moved.description).toContain("Kept, not wiped.");
    expect(moved.priority).toBe(4);
    expect(moved.reminders?.length).toBe(1);

    const cleared = await updateTask(http, moved, { due_date: VIKUNJA_NULL_DATE });
    // Whatever shape the server echoes back, it must not be a real date.
    expect(seconds(cleared.due_date)).toBeLessThan(seconds("1970-01-01T00:00:00Z") + 1);
    expect(cleared.priority).toBe(4);
    expect(cleared.description).toContain("Kept, not wiped.");
    expect(cleared.reminders?.length).toBe(1);
    expect(cleared.assignees?.length).toBe(1);
  });

  it("replacing the reminders changes nothing else", { timeout: 30_000 }, async () => {
    /*
     * The write that has no column of its own. It names `title` and writes it
     * back unchanged, and the next test is why: the obvious alternative wipes
     * the task.
     */
    const { task, due } = await scratchTask("reminders", {});

    const changed = await updateReminders(http, task, [
      { relative_period: -86_400, relative_to: "due_date" },
      { relative_period: 0, relative_to: "due_date" },
    ]);

    expect(changed.reminders?.length).toBe(2);
    expect(changed.reminders?.map((r) => r.relative_period).sort()).toEqual([-86_400, 0]);
    expect(changed.title).toBe(task.title);
    expect(changed.description).toContain("Kept, not wiped.");
    expect(seconds(changed.due_date)).toBe(seconds(due));
    expect(changed.priority).toBe(3);
    expect(changed.assignees?.length).toBe(1);

    const none = await updateReminders(http, changed, []);
    expect(none.reminders ?? []).toHaveLength(0);
    expect(none.priority).toBe(3);
    expect(none.description).toContain("Kept, not wiped.");
  });

  it("an empty fields list WIPES the task, which is why one is always named", {
    timeout: 30_000,
  }, async () => {
    /*
     * Deliberately destructive, on a task created for it. This is the finding
     * `updateReminders` exists to route around: `fields: []` reads as "no
     * column is protected", not "no column is written", so every column falls
     * through to the zero-reapply path of mapping §6 item 13.
     *
     * It goes through raw http rather than updateTask because updateTask
     * refuses to make this call at all - that refusal is the guard this test
     * justifies, and if a future Vikunja stops behaving this way, this test
     * fails and the guard can be reconsidered on evidence.
     */
    const { task } = await scratchTask("empty-fields", {});

    await http.request("/tasks/bulk", {
      method: "POST",
      body: {
        task_ids: [task.id],
        fields: [],
        values: {
          reminders: [{ relative_period: -600, relative_to: "due_date" }],
          assignees: [],
        },
      },
    });

    const wrecked = await http.request<Task>(`/tasks/${task.id}`);
    expect(wrecked.priority ?? 0).toBe(0);
    expect(wrecked.description ?? "").toBe("");
    expect(seconds(wrecked.due_date)).toBeLessThan(seconds("1970-01-01T00:00:00Z") + 1);
    // The reminder DID land, which is what makes the trap convincing.
    expect(wrecked.reminders?.length).toBe(1);
  });
});
