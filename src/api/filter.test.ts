import { describe, expect, it } from "vitest";
import {
  and,
  dueBeforeTomorrow,
  labelIn,
  notDone,
  projectIs,
  quote,
  updatedSince,
} from "./filter";

describe("Vikunja filter expressions", () => {
  it("quotes values in single quotes", () => {
    expect(quote("hello")).toBe("'hello'");
  });

  it("escapes an embedded single quote by doubling it", () => {
    expect(quote("it's")).toBe("'it''s'");
  });

  it("builds the verified incremental-refresh filter", () => {
    // mapping §6 item 4: `updated >= '2026-09-08T00:00:00Z'` returns 200.
    const since = new Date(Date.UTC(2026, 8, 8, 0, 0, 0));
    expect(updatedSince(since)).toBe("updated >= '2026-09-08T00:00:00Z'");
  });

  it("builds the verified Today filter", () => {
    // mapping §6 item 4: `due_date < now/d+1d` is valid date math.
    expect(dueBeforeTomorrow()).toBe("due_date < now/d+1d");
  });

  it("builds the open-tasks-in-a-project filter", () => {
    expect(and(notDone(), projectIs(12))).toBe("done = false && project = 12");
  });

  it("builds a label filter with the list syntax", () => {
    expect(labelIn([3, 7])).toBe("labels in [3, 7]");
  });

  it("drops empty clauses when joining", () => {
    expect(and(notDone(), "", undefined, projectIs(1))).toBe(
      "done = false && project = 1",
    );
  });

  it("returns an empty string when every clause is empty", () => {
    expect(and(undefined, "")).toBe("");
  });
});
