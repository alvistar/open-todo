import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import {
  groupTasksForView,
  groupToday,
  groupUpcoming,
  todayHeading,
  upcomingHeading,
} from "./grouping";
import { inboxView, todayView, upcomingView } from "./views";

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

describe("grouping does not depend on what a view is CALLED", () => {
  it("still cuts Today into sections once it is read through a saved filter", () => {
    /*
     * The regression this pins, found by driving the app and not by any test
     * here: Today's key became `today@v42` when it started carrying its view
     * id, and `groupTasksForView` was comparing that key against the literal
     * "today". The Overdue heading silently disappeared and the whole suite
     * stayed green. A key identifies a cache entry; the grouping is its own
     * field now.
     */
    const ordered = todayView({ projectId: -10, viewId: 42 });
    expect(ordered.key).not.toBe("today");

    const groups = groupTasksForView(
      ordered,
      [task(1, "2026-09-01T10:00:00Z"), task(2, "2026-09-09T10:00:00Z")],
      {
        now: NOW,
        timeZone: TZ,
      },
    );
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today"]);
  });
});

describe("groupUpcoming", () => {
  const TOMORROW = "2026-09-10T09:00:00Z";
  const ALSO_TOMORROW = "2026-09-10T18:00:00Z";
  const LATER = "2026-09-12T09:00:00Z";

  it("makes one section per day, in order", () => {
    const groups = groupUpcoming(
      [task(3, LATER), task(1, TOMORROW), task(2, ALSO_TOMORROW)],
      NOW,
      TZ,
    );
    expect(groups.map((g) => g.key)).toEqual(["day:2026-09-10", "day:2026-09-12"]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual([3]);
  });

  it("sorts the sections even when the tasks arrive out of order", () => {
    // The server sorts by due date, but the poll merges and a manual order
    // does not: the sections are chronological whatever orders the rows.
    const groups = groupUpcoming([task(1, LATER), task(2, TOMORROW)], NOW, TZ);
    expect(groups.map((g) => g.key)).toEqual(["day:2026-09-10", "day:2026-09-12"]);
  });

  it("cuts days in the USER's zone, not in UTC", () => {
    /*
     * 23:30Z on the 10th is already the 11th in Rome, and 00:30Z on the 11th
     * is still the 11th. A key built from the UTC date would put them in
     * different sections and label one of them with the wrong day.
     */
    const groups = groupUpcoming(
      [task(1, "2026-09-10T23:30:00Z"), task(2, "2026-09-11T00:30:00Z")],
      NOW,
      TZ,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("day:2026-09-11");
  });

  it("drops a task with no due date rather than inventing a section", () => {
    // It cannot arrive through the filter, but the incremental poll is not
    // scoped by the filter and hands this whatever changed.
    expect(groupUpcoming([task(1)], NOW, TZ)).toEqual([]);
  });

  it("is empty for an empty view, with no placeholder day", () => {
    expect(groupUpcoming([], NOW, TZ)).toEqual([]);
  });

  it("heads a section with the day and the weekday", () => {
    expect(upcomingHeading(new Date("2026-09-10T09:00:00Z"), TZ, "en-GB")).toBe(
      "10 Sept · Thursday",
    );
  });

  it("is reached through the view, by its grouping and not its key", () => {
    const ordered = upcomingView({ projectId: -9, viewId: 41 });
    const groups = groupTasksForView(ordered, [task(1, TOMORROW)], {
      now: NOW,
      timeZone: TZ,
    });
    expect(groups.map((g) => g.key)).toEqual(["day:2026-09-10"]);
  });
});
