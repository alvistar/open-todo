import { describe, expect, it } from "vitest";
import { DUE_SHORTCUTS, dueDateFromPhrase } from "./duePhrase";
import type { QuickAddContext } from "./quickadd/parse";

const context: QuickAddContext = {
  now: new Date("2026-09-15T08:00:00Z"),
  timeZone: "Europe/Rome",
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [],
  labels: [],
};

describe("dueDateFromPhrase", () => {
  it("reads a bare day as an all-day date", () => {
    const result = dueDateFromPhrase("tomorrow", context);
    expect(result.due?.toISOString()).toBe("2026-09-16T18:00:00.000Z");
    expect(result.allDay).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("keeps a time when the phrase names one", () => {
    const result = dueDateFromPhrase("tomorrow at 10", context);
    expect(result.due?.toISOString()).toBe("2026-09-16T08:00:00.000Z");
    expect(result.allDay).toBe(false);
  });

  it("says nothing was typed rather than guessing", () => {
    const result = dueDateFromPhrase("   ", context);
    expect(result.due).toBeNull();
    expect(result.reason).toBe("Type a date.");
  });

  it("refuses in its own words, not the composer's", () => {
    const result = dueDateFromPhrase("this weekend", context);
    expect(result.due).toBeNull();
    expect(result.reason).toContain("this weekend");
    /*
     * The acceptor's warning ends "and was kept in the task name". True in the
     * composer, false in a field that holds no task name - it sent the reader
     * looking for a title that was never involved. Caught by driving the app.
     */
    expect(result.reason).not.toContain("task name");
  });

  it("refuses a phrase it only half understood, naming the rest", () => {
    const result = dueDateFromPhrase("buy milk tomorrow", context);
    expect(result.due).toBeNull();
    expect(result.reason).toContain("buy milk");
  });

  it("refuses a repeat, which this field cannot write", () => {
    const result = dueDateFromPhrase("every monday", context);
    expect(result.due).toBeNull();
    expect(result.reason).toContain("repeat");
  });
});

describe("DUE_SHORTCUTS", () => {
  it.each(DUE_SHORTCUTS)("$label resolves to a date", ({ phrase }) => {
    const result = dueDateFromPhrase(phrase, context);
    expect(result.reason).toBeNull();
    expect(result.due).toBeInstanceOf(Date);
  });
});
