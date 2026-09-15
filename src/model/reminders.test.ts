import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import {
  canRemindRelatively,
  describeReminder,
  REMINDER_PRESETS,
  relativeReminder,
} from "./reminders";

const NOW = new Date("2026-09-15T08:00:00Z");
const task = (over: Partial<Task> = {}): Task => ({
  id: 1,
  title: "t",
  done: false,
  project_id: 1,
  created: "2026-09-01T10:00:00Z",
  updated: "2026-09-01T10:00:00Z",
  ...over,
});

describe("describeReminder", () => {
  it("reads a zero offset as the moment the task is due", () => {
    expect(
      describeReminder(
        { relative_period: 0, relative_to: "due_date" },
        NOW,
        "Europe/Rome",
        null,
      ),
    ).toBe("When it is due");
  });

  it("reads a negative offset as time before", () => {
    const reads = (seconds: number) =>
      describeReminder(
        { relative_period: seconds, relative_to: "due_date" },
        NOW,
        "Europe/Rome",
        null,
      );

    expect(reads(-600)).toBe("10 minutes before it is due");
    expect(reads(-3600)).toBe("1 hour before it is due");
    expect(reads(-86_400)).toBe("1 day before it is due");
    expect(reads(-172_800)).toBe("2 days before it is due");
  });

  it("reads a positive offset as time after", () => {
    expect(
      describeReminder(
        { relative_period: 3600, relative_to: "due_date" },
        NOW,
        "Europe/Rome",
        null,
      ),
    ).toBe("1 hour after it is due");
  });

  it("reads an absolute reminder as a date", () => {
    const text = describeReminder(
      { reminder: "2026-09-16T18:00:00Z" },
      NOW,
      "Europe/Rome",
      null,
    );
    expect(text).toContain("Tomorrow");
  });

  it("says plainly when it cannot read one at all", () => {
    expect(describeReminder({}, NOW, "Europe/Rome", null)).toBe("A reminder");
  });
});

describe("canRemindRelatively", () => {
  it("needs a due date, because the offset is measured from one", () => {
    expect(canRemindRelatively(task({ due_date: "2026-09-20T18:00:00Z" }))).toBe(true);
    expect(canRemindRelatively(task())).toBe(false);
    // Vikunja's unset date is a real string, not an absent field.
    expect(canRemindRelatively(task({ due_date: "0001-01-01T00:00:00Z" }))).toBe(false);
  });
});

describe("relativeReminder", () => {
  it("builds the shape Vikunja stores", () => {
    expect(relativeReminder(-3600)).toEqual({
      relative_period: -3600,
      relative_to: "due_date",
    });
  });
});

describe("REMINDER_PRESETS", () => {
  it("offers the measured set, all anchored to the due date", () => {
    expect(REMINDER_PRESETS.map((p) => p.seconds)).toEqual([0, -600, -3600, -86_400]);
  });
});
