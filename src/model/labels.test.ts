import { describe, expect, it } from "vitest";
import type { Label } from "../api/types";
import { attachableLabels, canCreateLabel } from "./labels";

const all: Label[] = [
  { id: 3, title: "urgent" },
  { id: 1, title: "Home" },
  { id: 2, title: "work" },
  { id: 4, title: "homework" },
];

describe("attachableLabels", () => {
  it("leaves out the ones already on the task", () => {
    expect(
      attachableLabels(all, [{ id: 1, title: "Home" }], "").map((l) => l.title),
    ).toEqual(["homework", "urgent", "work"]);
  });

  it("sorts by name, not by the order the server happened to return", () => {
    expect(attachableLabels(all, [], "").map((l) => l.title)).toEqual([
      "Home",
      "homework",
      "urgent",
      "work",
    ]);
  });

  it("matches anywhere in the name, ignoring case", () => {
    expect(attachableLabels(all, [], "OME").map((l) => l.title)).toEqual([
      "Home",
      "homework",
    ]);
  });

  it("ignores the spaces around what was typed", () => {
    expect(attachableLabels(all, [], "  work ").map((l) => l.title)).toEqual([
      "homework",
      "work",
    ]);
  });

  it("offers everything when nothing is typed", () => {
    expect(attachableLabels(all, [], "   ")).toHaveLength(4);
  });
});

describe("canCreateLabel", () => {
  it("offers to create a name the instance does not have", () => {
    expect(canCreateLabel(all, "gardening")).toBe(true);
  });

  it("refuses an empty field", () => {
    expect(canCreateLabel(all, "   ")).toBe(false);
  });

  it("refuses a name that already exists, however it is cased", () => {
    // Vikunja does not enforce unique titles, so this is the only guard
    // against an instance ending up with two labels called "urgent".
    expect(canCreateLabel(all, "urgent")).toBe(false);
    expect(canCreateLabel(all, "  URGENT ")).toBe(false);
  });

  it("does not mistake a partial match for the same name", () => {
    expect(canCreateLabel(all, "home")).toBe(false);
    expect(canCreateLabel(all, "homewor")).toBe(true);
  });
});
