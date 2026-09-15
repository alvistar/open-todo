import { describe, expect, it } from "vitest";
import { type Decision, off, withDecisions } from "./decisions";
import { parseQuickAdd, type QuickAddContext } from "./parse";

/*
 * The composer's half of the bargain: the parser reports what it recognised,
 * and the user decides what is applied. These tests drive REAL parse results
 * rather than hand-built ones, because the thing most likely to break is the
 * agreement between the two - a title recomposed here differently from the way
 * parse.ts composes it would show one thing and save another.
 */

const TZ = "Europe/Rome";
// Wednesday 9 September 2026, 10:00 in Rome.
const NOW = new Date("2026-09-09T08:00:00Z");

const ctx = (): QuickAddContext => ({
  now: NOW,
  timeZone: TZ,
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [
    { id: 1, title: "Inbox" },
    { id: 3, title: "Work" },
  ],
  labels: [{ id: 10, title: "phone" }],
});

const parse = (text: string) => parseQuickAdd(text, ctx());
const decide = (text: string, decisions: Decision[]) =>
  withDecisions(parse(text), text, decisions, ctx().defaultProjectId);

describe("switching a value off", () => {
  it("clears the due date and puts the words back in the title", () => {
    const text = "call the accountant tomorrow at 10";
    expect(parse(text).dueDate).not.toBeNull();

    const r = decide(text, [off("date", "tomorrow at 10")]);

    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("call the accountant tomorrow at 10");
  });

  it("marks the span rather than dropping it, so the overlay can show it", () => {
    const r = decide("call the accountant tomorrow at 10", [
      off("date", "tomorrow at 10"),
    ]);
    const date = r.spans.find((span) => span.kind === "date");

    expect(date).toBeDefined();
    expect(date?.off).toBe(true);
  });

  it("clears a priority", () => {
    const r = decide("pay the invoice p1", [off("priority", "p1")]);
    expect(r.priority).toBeNull();
    expect(r.title).toBe("pay the invoice p1");
  });

  it("clears a project, falling back to the default", () => {
    const r = decide("ship it #Work", [off("project", "#Work")]);
    expect(r.projectId).toBeNull();
    expect(r.effectiveProjectId).toBe(1);
    expect(r.title).toBe("ship it #Work");
  });

  it("deletes repeatAfter rather than setting it undefined", () => {
    // parse.ts omits the key by spread when unset; a literal `undefined` would
    // be a different object and would reach the API as an explicit null.
    const r = decide("water the plants every 2 days", [
      off("recurrence", "every 2 days"),
    ]);

    expect("repeatAfter" in r).toBe(false);
    expect("repeatMode" in r).toBe(false);
  });

  it("leaves everything else alone", () => {
    const text = "ship it #Work tomorrow at 10 p1";
    const r = decide(text, [off("date", "tomorrow at 10")]);

    expect(r.projectId).toBe(3);
    expect(r.priority).toBe(4);
    expect(r.dueDate).toBeNull();
  });
});

describe("the decision key", () => {
  it("ignores case and extra spaces, which the composer cannot normalise for us", () => {
    const r = decide("call the accountant tomorrow at 10", [
      off("date", "  TOMORROW   at 10 "),
    ]);
    expect(r.dueDate).toBeNull();
  });

  it("is not offsets: editing earlier in the line keeps the decision", () => {
    const decisions = [off("date", "tomorrow at 10")];
    const before = decide("call tomorrow at 10", decisions);
    const after = decide("call the accountant tomorrow at 10", decisions);

    expect(before.dueDate).toBeNull();
    expect(after.dueDate).toBeNull();
  });

  it("stays switched off when the user retypes a DIFFERENT date", () => {
    // The sticky fallback. Without it a dropped value silently comes back the
    // moment the words change, which is the failure the switch exists to stop.
    const r = decide("call the accountant on friday", [off("date", "tomorrow at 10")]);
    expect(r.dueDate).toBeNull();
  });
});

describe("nothing decided", () => {
  it("returns a result equal to the parse, so the composer can call it always", () => {
    const text = "ship it #Work tomorrow at 10 p1";
    expect(withDecisions(parse(text), text, [])).toEqual(parse(text));
  });
});
