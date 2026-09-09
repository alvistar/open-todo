import { describe, expect, it } from "vitest";
import {
  PRIORITIES,
  type Priority,
  priorityFromVikunja,
  priorityToVikunja,
  priorityWriteChangesValue,
} from "./priority";

describe("D-map-1 priority mapping", () => {
  it("reads the documented Vikunja values", () => {
    expect(priorityFromVikunja(5)).toBe(1);
    expect(priorityFromVikunja(4)).toBe(1);
    expect(priorityFromVikunja(3)).toBe(2);
    expect(priorityFromVikunja(2)).toBe(3);
    expect(priorityFromVikunja(1)).toBe(3);
    expect(priorityFromVikunja(0)).toBe(4);
  });

  it("writes the documented Vikunja values", () => {
    expect(priorityToVikunja(1)).toBe(4);
    expect(priorityToVikunja(2)).toBe(3);
    expect(priorityToVikunja(3)).toBe(2);
    expect(priorityToVikunja(4)).toBe(0);
  });

  it("treats a missing or malformed priority as p4", () => {
    expect(priorityFromVikunja(null)).toBe(4);
    expect(priorityFromVikunja(undefined)).toBe(4);
    expect(priorityFromVikunja(Number.NaN)).toBe(4);
  });

  it("clamps values above the Vikunja range to p1", () => {
    expect(priorityFromVikunja(9)).toBe(1);
  });

  it("round-trips every priority we write", () => {
    for (const p of PRIORITIES) {
      expect(priorityFromVikunja(priorityToVikunja(p))).toBe(p as Priority);
    }
  });

  it("flags exactly the foreign values a write would rewrite", () => {
    // 5 (DO NOW) and 1 (Low) have no distinct open-todo priority: writing
    // would collapse them to 4 and 2. The UI must not do that unprompted.
    expect(priorityWriteChangesValue(5)).toBe(true);
    expect(priorityWriteChangesValue(1)).toBe(true);
    // Values we ourselves write are stable.
    for (const p of PRIORITIES) {
      expect(priorityWriteChangesValue(priorityToVikunja(p))).toBe(false);
    }
  });
});
