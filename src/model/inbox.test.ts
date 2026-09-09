import { describe, expect, it } from "vitest";
import type { Project, User } from "../api/types";
import { resolveInboxProjectId, sidebarProjects } from "./inbox";

const project = (id: number, title: string, over: Partial<Project> = {}): Project =>
  ({ id, title, ...over }) as Project;

const user = (defaultProjectId?: number): User =>
  ({ id: 1, username: "a", settings: { default_project_id: defaultProjectId } }) as User;

describe("resolveInboxProjectId", () => {
  it("prefers the user's default_project_id", () => {
    expect(resolveInboxProjectId(user(4), [project(1, "Inbox")])).toBe(4);
  });

  it("falls back to a project titled Inbox when /user is unavailable", () => {
    expect(
      resolveInboxProjectId(undefined, [project(9, "Work"), project(3, "Inbox")]),
    ).toBe(3);
  });

  it("matches the Inbox title case- and space-insensitively", () => {
    expect(resolveInboxProjectId(undefined, [project(3, "  inbox ")])).toBe(3);
  });

  it("falls back to the lowest id when nothing is named Inbox", () => {
    expect(
      resolveInboxProjectId(undefined, [project(9, "Work"), project(4, "Home")]),
    ).toBe(4);
  });

  it("returns null when there are no projects at all", () => {
    expect(resolveInboxProjectId(undefined, [])).toBeNull();
    expect(resolveInboxProjectId(undefined, undefined)).toBeNull();
  });

  it("ignores a zero or missing default_project_id", () => {
    expect(resolveInboxProjectId(user(0), [project(7, "Work")])).toBe(7);
  });
});

describe("sidebarProjects", () => {
  it("hides the inbox and archived projects, sorted by title", () => {
    const projects = [
      project(1, "Inbox"),
      project(2, "Work"),
      project(3, "Admin"),
      project(4, "Old", { is_archived: true }),
    ];
    expect(sidebarProjects(projects, 1).map((p) => p.title)).toEqual(["Admin", "Work"]);
  });
});
