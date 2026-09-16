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
  addLabel,
  addSubtask,
  createComment,
  createLabel,
  createTask,
  deleteLabel,
  deleteTask,
  getTask,
  getUser,
  listComments,
  listProjects,
  removeLabel,
  updateReminders,
  updateTask,
} from "./endpoints";
import { createHttp } from "./http";
import { type Project, type ProjectView, type Task, VIKUNJA_NULL_DATE } from "./types";

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
/** And every label, which lives on the INSTANCE rather than on a task. */
const createdLabels: number[] = [];
/**
 * And every project and saved filter, which the position probes need.
 *
 * They exist because the renumber probe deliberately drives a whole view past
 * MinPositionSpacing: run in the owner's default project it would permanently
 * rewrite the order of their real Inbox, which is not a thing a test may do to
 * recover a measurement.
 */
const createdProjects: number[] = [];
const createdFilters: number[] = [];

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
  for (const id of createdLabels) {
    try {
      await deleteLabel(http, id);
    } catch {
      console.warn(`  could not delete scratch label ${id}`);
    }
  }
  for (const id of createdFilters) {
    try {
      await http.request(`/filters/${id}`, { method: "DELETE" });
    } catch {
      console.warn(`  could not delete scratch saved filter ${id}`);
    }
  }
  // Projects last: deleting one takes its tasks with it, so an earlier task
  // deletion that failed is not made worse by this running first.
  for (const id of createdProjects) {
    try {
      await http.request(`/projects/${id}`, { method: "DELETE" });
    } catch {
      console.warn(`  could not delete scratch project ${id}`);
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

  it("attaching and detaching a label leaves the task alone", {
    timeout: 30_000,
  }, async () => {
    /*
     * Labels are a sub-resource, so they do not go through the `fields` guard
     * at all - which is exactly why this is worth measuring rather than
     * assuming. It also pins the read-back the UI depends on: the label calls
     * answer with the relation, so the task has to be fetched again.
     */
    const { task, due } = await scratchTask("labels", {});
    /*
     * Its own label, not one the instance happened to have. `pinguino` has
     * none at all, which is how the first cut of this test failed - and a test
     * that depends on someone else's data is a test that fails for a reason
     * that is not the code.
     */
    const label = await createLabel(http, `open-todo write test ${Date.now()}`);
    createdLabels.push(label.id);

    await addLabel(http, task.id, label.id);
    const withLabel = await getTask(http, task.id);

    expect(withLabel.labels?.map((l) => l.id)).toContain(label.id);
    expect(withLabel.description).toContain("Kept, not wiped.");
    expect(seconds(withLabel.due_date)).toBe(seconds(due));
    expect(withLabel.priority).toBe(3);
    expect(withLabel.reminders?.length).toBe(1);
    expect(withLabel.assignees?.length).toBe(1);

    await removeLabel(http, task.id, label.id);
    const without = await getTask(http, task.id);

    expect(without.labels ?? []).toHaveLength(0);
    expect(without.priority).toBe(3);
    expect(without.reminders?.length).toBe(1);
  });

  it("a comment is stored and read back, and bumps comment_count", {
    timeout: 30_000,
  }, async () => {
    const { task } = await scratchTask("comments", {});

    const created = await createComment(http, task.id, "<p>first note</p>");
    expect(created.comment).toContain("first note");
    expect(created.author?.username).toBeTruthy();

    const listed = await listComments(http, task.id);
    expect(listed.map((c) => c.id)).toContain(created.id);

    /*
     * The row badge reads `comment_count`, which is absent without the expand
     * (mapping §6 item 2) - so this asserts the flag, not just the comment.
     */
    const withCount = await http.request<Task[]>(
      `/tasks?filter=id = ${task.id}&expand=comment_count`,
    );
    expect(withCount[0]?.comment_count).toBe(1);

    // And the task itself is untouched by any of it.
    const after = await getTask(http, task.id);
    expect(after.description).toContain("Kept, not wiped.");
    expect(after.priority).toBe(3);
    expect(after.reminders?.length).toBe(1);
  });

  it("a sub-task relation is written on both sides at once", {
    timeout: 30_000,
  }, async () => {
    /*
     * The claim the list views now depend on: a child is recognised by its
     * `parenttask` relation, and nothing writes that directly - it appears
     * because the PARENT was given a `subtask`. If a future Vikunja stopped
     * mirroring it, every sub-task would reappear as a top-level row and this
     * is what would say so.
     */
    const { task: parent } = await scratchTask("parent", {});
    const child = await createTask(http, parent.project_id, {
      title: "open-todo write test: child",
    });
    created.push(child.id);

    await addSubtask(http, parent.id, child.id);

    const storedParent = await getTask(http, parent.id);
    const storedChild = await getTask(http, child.id);

    expect(storedParent.related_tasks?.subtask?.map((t) => t.id)).toEqual([child.id]);
    expect(storedChild.related_tasks?.parenttask?.map((t) => t.id)).toEqual([parent.id]);
    // Writing a relation is not a task write: the parent is otherwise untouched.
    expect(storedParent.description).toContain("Kept, not wiped.");
    expect(storedParent.priority).toBe(3);
    expect(storedParent.reminders?.length).toBe(1);
  });

  /*
   * ---------------------------------------------------------------------
   * D4 step 3: does an order survive a round trip?
   *
   * Mapping §3 is read from Vikunja's source on `main`: the route name, the
   * midpoint arithmetic, MinPositionSpacing and the server-side renumber. None
   * of it has ever been called, and `/tasks/all` already vanished between
   * versions on this very instance. Everything in the ordering slice rests on
   * the first of these passing.
   * ---------------------------------------------------------------------
   */

  /** A project of our own, with its own views and its own order to scramble. */
  async function scratchProject(name: string): Promise<{
    project: Project;
    listViewId: number;
  }> {
    const project = await http.request<Project>("/projects", {
      method: "PUT",
      body: { title: `open-todo position probe: ${name}` },
    });
    createdProjects.push(project.id);

    const views =
      project.views && project.views.length > 0
        ? project.views
        : await http.request<ProjectView[]>(`/projects/${project.id}/views`);
    const list = views.find((v) => v.view_kind === "list");
    if (!list) throw new Error("A fresh project came with no list view.");
    return { project, listViewId: list.id };
  }

  const viewTasks = (projectId: number, viewId: number) =>
    http.request<Task[]>(`/projects/${projectId}/views/${viewId}/tasks`);

  it("a fresh project's list view gives every task a position", {
    timeout: 30_000,
  }, async () => {
    const { project, listViewId } = await scratchProject("read");
    for (const title of ["one", "two", "three"]) {
      const task = await createTask(http, project.id, {
        title: `open-todo position probe: ${title}`,
      });
      created.push(task.id);
    }

    const tasks = await viewTasks(project.id, listViewId);
    expect(tasks.length).toBe(3);
    for (const task of tasks) expect(typeof task.position).toBe("number");
    console.log(
      `  created order/positions: ${tasks.map((t) => `${t.title.slice(-5)}=${t.position}`).join(" ")}`,
    );
  });

  it("POST /tasks/{id}/position moves a task and the value round-trips", {
    timeout: 30_000,
  }, async () => {
    // THE GATE. If this fails, the drag slice has no store to write to and the
    // plan says stop rather than build the gesture on top of nothing.
    const { project, listViewId } = await scratchProject("move");
    for (const title of ["a", "b", "c"]) {
      const task = await createTask(http, project.id, {
        title: `open-todo position probe: ${title}`,
      });
      created.push(task.id);
    }

    const before = await viewTasks(project.id, listViewId);
    expect(before.length).toBe(3);
    const [first, second, third] = before as [Task, Task, Task];

    // Move the LAST one between the first two: midpoint, exactly as §3 says.
    const target = (Number(first.position) + Number(second.position)) / 2;
    await http.request(`/tasks/${third.id}/position`, {
      method: "POST",
      body: { project_view_id: listViewId, position: target },
    });

    const after = await viewTasks(project.id, listViewId);
    expect(after.map((t) => t.id)).toEqual([first.id, third.id, second.id]);
    const moved = after.find((t) => t.id === third.id);
    expect(moved?.position).toBeCloseTo(target, 6);
    console.log(`  wrote ${target}, stored ${moved?.position}`);
  });

  it("reports whether a sub-spacing write makes the server renumber the view", {
    timeout: 30_000,
  }, async () => {
    /*
     * §3 says a gap under MinPositionSpacing (0.01) makes the server renumber
     * the WHOLE view, so the stored value may differ from the one sent. If that
     * is true the reorder hook must re-read after such a write; if it is not,
     * the conditional re-read is dead code. Reported rather than asserted -
     * either answer is a finding, and only one of them is a bug.
     */
    const { project, listViewId } = await scratchProject("renumber");
    for (const title of ["p", "q", "r", "s"]) {
      const task = await createTask(http, project.id, {
        title: `open-todo position probe: ${title}`,
      });
      created.push(task.id);
    }

    const before = await viewTasks(project.id, listViewId);
    const [first, , , last] = before as [Task, Task, Task, Task];
    const crowded = Number(first.position) + 0.001;

    await http.request(`/tasks/${last.id}/position`, {
      method: "POST",
      body: { project_view_id: listViewId, position: crowded },
    });

    const after = await viewTasks(project.id, listViewId);
    const byId = new Map(after.map((t) => [t.id, t.position]));
    const others = before.filter((t) => t.id !== last.id);
    const changed = others.filter((t) => byId.get(t.id) !== t.position);
    const stored = byId.get(last.id);

    console.log(`  wrote ${crowded}, stored ${stored}`);
    console.log(`  ${changed.length} of ${others.length} other tasks were renumbered`);
    if (changed.length === 0 && stored === crowded) {
      console.log("  -> NO RENUMBER on 2.5.0: the conditional re-read is unnecessary.");
    } else {
      console.log(
        "  -> RENUMBER CONFIRMED: positions must be re-read after a crowded write.",
      );
    }
    // Whatever it stored, the order the user asked for must hold.
    expect(after[1]?.id).toBe(last.id);
  });

  it("reports whether a saved filter's view accepts a position write (§4)", {
    timeout: 30_000,
  }, async () => {
    // Today can only carry a manual order if this works. Nothing else can tell
    // us: §6 item 5 verified saved filters only as far as READING them.
    const { project } = await scratchProject("filter host");
    const task = await createTask(http, project.id, {
      title: "open-todo position probe: filtered",
      priority: 5,
    });
    created.push(task.id);

    const saved = await http.request<{ id: number }>("/filters", {
      method: "PUT",
      body: {
        title: "open-todo position probe filter",
        filters: { filter: "done = false && priority = 5" },
      },
    });
    createdFilters.push(saved.id);

    const projects = await listProjects(http);
    const asProject = projects.find((p) =>
      p.title.includes("open-todo position probe filter"),
    );
    console.log(`  saved filter ${saved.id} appears as project id ${asProject?.id}`);
    console.log(`  formula -(filter_id + 1) predicts ${-saved.id - 1}`);

    if (!asProject) {
      console.log(
        "  -> the saved filter is NOT in GET /projects; Today cannot be built on it.",
      );
      return;
    }

    let views: ProjectView[] = [];
    try {
      views = await http.request<ProjectView[]>(`/projects/${asProject.id}/views`);
      console.log(`  its views: ${views.map((v) => `${v.id}:${v.view_kind}`).join(" ")}`);
    } catch (error) {
      console.log(
        `  -> views REJECTED (status ${(error as { status?: number }).status})`,
      );
      return;
    }

    const list = views.find((v) => v.view_kind === "list");
    if (!list) {
      console.log("  -> the saved filter has no list view.");
      return;
    }

    try {
      const tasks = await http.request<Task[]>(
        `/projects/${asProject.id}/views/${list.id}/tasks`,
      );
      console.log(`  its list view returns ${tasks.length} task(s)`);
      await http.request(`/tasks/${task.id}/position`, {
        method: "POST",
        body: { project_view_id: list.id, position: 42 },
      });
      const after = await http.request<Task[]>(
        `/projects/${asProject.id}/views/${list.id}/tasks`,
      );
      const stored = after.find((t) => t.id === task.id)?.position;
      console.log(`  POSITION WRITE ON A SAVED FILTER ACCEPTED, stored ${stored}`);
      console.log("  -> Today can carry a manual order.");
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = (error as { message?: string }).message;
      console.log(
        `  -> position write on the filter view REJECTED (${status}): ${message}`,
      );
      console.log("  -> Today stays due-date ordered and gets no drag handle.");
    }
  });

  it("confirms the bulk route does not write a position (negative control)", {
    timeout: 30_000,
  }, async () => {
    // Positions live in their own table, so `fields: ["position"]` should be
    // inert. If it is NOT, it is a fallback worth knowing about.
    const { project, listViewId } = await scratchProject("bulk");
    for (const title of ["x", "y"]) {
      const task = await createTask(http, project.id, {
        title: `open-todo position probe: ${title}`,
      });
      created.push(task.id);
    }
    const before = await viewTasks(project.id, listViewId);
    const [, second] = before as [Task, Task];

    try {
      await http.request("/tasks/bulk", {
        method: "POST",
        body: {
          task_ids: [second.id],
          fields: ["position"],
          values: { position: 0.5, reminders: [], assignees: [] },
        },
      });
      const after = await viewTasks(project.id, listViewId);
      const stored = after.find((t) => t.id === second.id)?.position;
      console.log(
        `  bulk fields:["position"] accepted; stored ${stored} (was ${second.position})`,
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      console.log(`  bulk fields:["position"] rejected (status ${status}) - as expected`);
    }
  });
});
