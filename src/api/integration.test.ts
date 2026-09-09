/*
 * Read-only integration test against a real Vikunja instance.
 *
 * Skipped unless both are set, so the default `pnpm test` needs no server:
 *
 *   VIKUNJA_TEST_URL=https://vikunja.example \
 *   VIKUNJA_TEST_TOKEN=tk_... \
 *   pnpm test src/api/integration.test.ts
 *
 * It only reads. Nothing here writes to the instance.
 */
import { describe, expect, it } from "vitest";
import { getInfo, getUser, listProjects, listTasks } from "./endpoints";
import { and, dueBeforeTomorrow, notDone, updatedSince } from "./filter";
import { createHttp } from "./http";

// Declared locally rather than pulling @types/node into the app's global
// scope, which would make `process` reachable from browser code.
declare const process: { env: Record<string, string | undefined> };

const baseUrl = process.env.VIKUNJA_TEST_URL;
const token = process.env.VIKUNJA_TEST_TOKEN;
const enabled = Boolean(baseUrl && token);

describe.skipIf(!enabled)("live Vikunja instance (read-only)", () => {
  const http = createHttp({
    getBaseUrl: () => baseUrl ?? null,
    getToken: () => token ?? null,
  });

  it("reports its version from /info", async () => {
    const info = await getInfo(http);
    expect(typeof info.version).toBe("string");
    console.log(`  instance version: ${info.version}`);
  });

  it("reads the user and its default project", async () => {
    const user = await getUser(http);
    expect(user.id).toBeGreaterThan(0);
    console.log(`  default_project_id: ${user.settings?.default_project_id}`);
  });

  it("lists projects", async () => {
    const projects = await listProjects(http);
    expect(Array.isArray(projects)).toBe(true);
  });

  it("accepts the Today filter with a timezone", async () => {
    const tasks = await listTasks(http, {
      filter: and(notDone(), dueBeforeTomorrow()),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sortBy: ["due_date", "id"],
      orderBy: ["asc", "asc"],
    });
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("accepts the incremental `updated >=` filter", async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const tasks = await listTasks(http, { filter: updatedSince(since) });
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("confirms related_tasks arrives without expand (mapping §6 item 2)", async () => {
    const tasks = await listTasks(http, { filter: notDone() });
    const withRelations = tasks.filter((t) => t.related_tasks != null);
    console.log(
      `  ${withRelations.length} of ${tasks.length} open tasks carry related_tasks`,
    );
    for (const t of withRelations) expect(typeof t.related_tasks).toBe("object");
  });

  it("reports whether subtask relations carry done (the 0/N badge needs it)", async () => {
    // Under a `done = false` filter a completed child is never in the listing,
    // so the badge's done-count relies on the relation object itself carrying
    // `done`. This asserts nothing - it reports, so the assumption in
    // src/model/taskRow.ts can be confirmed or corrected against a real server.
    const tasks = await listTasks(http, { filter: notDone() });
    const relations = tasks.flatMap((t) => t.related_tasks?.subtask ?? []);
    const withDone = relations.filter((r) => typeof r.done === "boolean");
    console.log(
      `  subtask relations: ${relations.length}; carrying a boolean done: ${withDone.length}`,
    );
    if (relations.length > 0 && withDone.length === 0) {
      console.warn(
        "  WARNING: no subtask relation carries done - the 0/N badge will under-report.",
      );
    }
  });

  it("confirms deleted_at is still not filterable (mapping §6 item 3)", async () => {
    await expect(
      listTasks(http, { filter: "deleted_at > '2026-01-01T00:00:00Z'" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reports whether `updated >= now-30s` is accepted (mapping §6 item 10)", async () => {
    // If the server evaluates this, the incremental poll can drop the browser
    // clock from the equation entirely - it is the single most valuable
    // unverified question in the refresh design.
    try {
      const tasks = await listTasks(http, { filter: "updated >= now-30s" });
      console.log(
        `  SERVER-RELATIVE FILTER SUPPORTED: "updated >= now-30s" returned ${tasks.length} task(s).`,
      );
      console.log(
        "  -> PollingSource can stop deriving its mark from the browser clock.",
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = (error as { message?: string }).message;
      console.log(`  server-relative filter REJECTED (status ${status}): ${message}`);
      console.log("  -> keep the server-timestamp mark; do not switch.");
    }
  });

  it("reports whether filter_timezone is honoured for Today's boundary", async () => {
    // Today is `due_date < now/d+1d`. If the server ignores filter_timezone,
    // "midnight" is the server's, not the user's, and the view is wrong near
    // the day boundary for anyone not in the server's zone.
    const inRome = await listTasks(http, {
      filter: and(notDone(), dueBeforeTomorrow()),
      timezone: "Europe/Rome",
    });
    const inAuckland = await listTasks(http, {
      filter: and(notDone(), dueBeforeTomorrow()),
      timezone: "Pacific/Auckland",
    });
    console.log(
      `  Today with filter_timezone Europe/Rome: ${inRome.length}; Pacific/Auckland: ${inAuckland.length}`,
    );
    if (inRome.length === inAuckland.length) {
      console.log(
        "  NOTE: identical counts. Either the data does not straddle the boundary, or filter_timezone is ignored - re-run near local midnight to tell them apart.",
      );
    }
  });

  it("reports the user's default_due_time and timezone (D-map-2)", async () => {
    const user = await getUser(http);
    const settings = user.settings ?? {};
    console.log(`  timezone: ${settings.timezone ?? "(unset)"}`);
    console.log(
      `  frontend_settings.default_due_time: ${settings.frontend_settings?.default_due_time ?? "(absent -> the 20:00 fallback applies)"}`,
    );
  });
});
