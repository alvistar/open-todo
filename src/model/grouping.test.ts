import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import { groupTasksForView, groupToday, todayHeading } from "./grouping";
import { inboxView, todayView } from "./views";

const TZ = "Europe/Rome";
const NOW = new Date("2026-09-09T08:00:00Z");

const task = (id: number, due?: string): Task =>
  ({
    id,
    title: `t${id}`,
    done: false,
    project_id: 1,
    ...(due ? { due_date: due } : {}),
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
  }) as Task;

describe("todayHeading", () => {
  it("matches the measured header shape: date, Today, weekday", () => {
    // en-GB abbreviates September as "Sept"; the shape is what is specified.
    expect(todayHeading(NOW, TZ, "en-GB")).toBe("9 Sept · Today · Wednesday");
    expect(todayHeading(new Date("2026-10-20T08:00:00Z"), TZ, "en-GB")).toBe(
      "20 Oct · Today · Tuesday",
    );
  });

  it("renders the date in the user's timezone", () => {
    // 23:30Z on the 9th is already the 10th in Rome.
    const late = new Date("2026-09-09T23:30:00Z");
    expect(todayHeading(late, TZ, "en-GB")).toContain("10 Sept");
    expect(todayHeading(late, "UTC", "en-GB")).toContain("9 Sept");
  });
});

describe("groupToday", () => {
  it("splits overdue from today", () => {
    const groups = groupToday(
      [task(1, "2026-09-01T10:00:00Z"), task(2, "2026-09-09T18:00:00Z")],
      NOW,
      TZ,
      "en-GB",
    );
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today"]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual([1]);
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual([2]);
  });

  it("omits the overdue section when nothing is overdue", () => {
    const groups = groupToday([task(1, "2026-09-09T18:00:00Z")], NOW, TZ, "en-GB");
    expect(groups.map((g) => g.key)).toEqual(["today"]);
  });

  it("keeps a today section when everything is overdue, so the date header stays", () => {
    const groups = groupToday([task(1, "2026-09-01T10:00:00Z")], NOW, TZ, "en-GB");
    expect(groups.map((g) => g.key)).toEqual(["overdue"]);
  });

  it("shows an empty today section when there is nothing at all", () => {
    expect(groupToday([], NOW, TZ, "en-GB").map((g) => g.key)).toEqual(["today"]);
  });

  it("uses the user's timezone for the split", () => {
    // 22:00Z on the 8th is 00:00 on the 9th in Rome: today, not overdue.
    const groups = groupToday([task(1, "2026-09-08T22:00:00Z")], NOW, TZ, "en-GB");
    expect(groups.map((g) => g.key)).toEqual(["today"]);
  });
});

describe("groupTasksForView", () => {
  it("leaves a project view as one unlabelled section", () => {
    const groups = groupTasksForView(inboxView(1), [task(1)], { now: NOW, timeZone: TZ });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBeUndefined();
  });

  it("groups the Today view", () => {
    const groups = groupTasksForView(todayView(), [task(1, "2026-09-01T10:00:00Z")], {
      now: NOW,
      timeZone: TZ,
    });
    expect(groups[0]?.title).toBe("Overdue");
  });
});

describe("locale consistency", () => {
  it("formats the heading in English by default, not the runtime locale", () => {
    // The slice ships English strings; a localised weekday next to an English
    // "Today" was a real bug ("9 set · Today · mercoledì").
    const heading = todayHeading(NOW, TZ);
    expect(heading).toContain("Today");
    expect(heading).toContain("Wednesday");
    expect(heading).not.toContain("mercoledì");
  });
});
