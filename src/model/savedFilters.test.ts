/*
 * Today is a query, not a place — but a manual order needs a place to live.
 * Vikunja's answer is the saved filter: it arrives in `GET /projects` under a
 * negative id, and its views take position writes like any project's (§6 items
 * 15 and 24). These are the two things that have to be got right before
 * adopting one: which filter a negative id refers to, and whether the filter
 * asks the same question we do.
 */
import { describe, expect, it } from "vitest";
import type { Project, SavedFilter } from "../api/types";
import { asksTheSameAs, filterIdFromProjectId, findSavedFilter } from "./savedFilters";

const project = (id: number, title: string): Project => ({ id, title });

describe("filterIdFromProjectId", () => {
  it("undoes Vikunja's -(filter_id + 1)", () => {
    // Pinned by measurement, not by reading: a scratch filter created as id 10
    // arrived as project -11 (§6 item 24). On `pinguino`, Today is -10 = 9.
    expect(filterIdFromProjectId(-11)).toBe(10);
    expect(filterIdFromProjectId(-10)).toBe(9);
    expect(filterIdFromProjectId(-9)).toBe(8);
  });
});

describe("findSavedFilter", () => {
  const projects = [
    project(1, "Inbox"),
    project(2, "Personale"),
    project(-9, "Upcoming"),
    project(-10, "Today"),
  ];

  it("finds one by title among the negative ids", () => {
    expect(findSavedFilter(projects, "Today")?.id).toBe(-10);
  });

  it("never mistakes a real project for a filter", () => {
    // The whole hazard of §6 item 15: nothing but the sign distinguishes them,
    // and a real project called "Today" is a place tasks can be put.
    expect(findSavedFilter([project(3, "Today")], "Today")).toBeUndefined();
  });

  it("is undefined when the instance has no such filter", () => {
    expect(findSavedFilter(projects, "Someday")).toBeUndefined();
    expect(findSavedFilter(undefined, "Today")).toBeUndefined();
  });
});

describe("asksTheSameAs", () => {
  const saved = (filter: string): SavedFilter => ({
    id: 9,
    title: "Today",
    filters: { filter },
  });
  const ours = "done = false && due_date < now/d+1d";

  it("accepts the query we would have written", () => {
    expect(asksTheSameAs(saved(ours), ours)).toBe(true);
  });

  it("forgives whitespace, which is not part of the question", () => {
    expect(asksTheSameAs(saved("done = false  &&  due_date < now/d+1d"), ours)).toBe(
      true,
    );
  });

  it("refuses a filter that asks something else", () => {
    /*
     * The reason this function exists. `pinguino` already had a Today at -10
     * that we did not write, and adopting it by title alone would silently
     * change what the screen shows — a filter is what produces the task list,
     * not merely where the order is kept.
     */
    expect(asksTheSameAs(saved("done = false && due_date < now/d"), ours)).toBe(false);
  });

  it("refuses one with no query at all", () => {
    expect(asksTheSameAs({ id: 9, title: "Today" }, ours)).toBe(false);
    expect(asksTheSameAs(undefined, ours)).toBe(false);
  });
});
