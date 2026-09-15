import { describe, expect, it } from "vitest";
import type { Task } from "../api/types";
import type { QuickAddContext } from "./quickadd/parse";
import { titleEdit } from "./titleEdit";

const context: QuickAddContext = {
  now: new Date("2026-09-15T08:00:00Z"),
  timeZone: "Europe/Rome",
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [{ id: 3, title: "Work" }],
  labels: [{ id: 7, title: "urgent" }],
};

const task = (over: Partial<Task> = {}): Task => ({
  id: 1,
  title: "Old name",
  done: false,
  project_id: 1,
  created: "2026-09-01T10:00:00Z",
  updated: "2026-09-01T10:00:00Z",
  ...over,
});

describe("titleEdit", () => {
  it("writes only the name when the phrase names nothing else", () => {
    const edit = titleEdit("Call mum", task(), context);
    expect(edit.values).toEqual({ title: "Call mum" });
    expect(edit.addLabelIds).toEqual([]);
    expect(edit.problem).toBeNull();
  });

  it("takes a date out of the name and into the write", () => {
    const edit = titleEdit("Call mum tomorrow", task(), context);
    expect(edit.values).toEqual({
      title: "Call mum",
      due_date: "2026-09-16T18:00:00.000Z",
    });
  });

  it("leaves a column alone when the phrase repeats what is already stored", () => {
    const edit = titleEdit(
      "Call mum tomorrow",
      task({ due_date: "2026-09-16T18:00:00Z" }),
      context,
    );
    // Naming a column is what makes it written, so an unchanged value must not
    // be named: it would be one more chance for a concurrent edit to be lost.
    expect(edit.values).toEqual({ title: "Call mum" });
  });

  it("moves the task when the phrase names another project", () => {
    const edit = titleEdit("Call mum #Work", task({ project_id: 1 }), context);
    expect(edit.values).toEqual({ title: "Call mum", project_id: 3 });
  });

  it("carries a label the task does not have, and skips one it does", () => {
    expect(titleEdit("Fix it @urgent", task(), context).addLabelIds).toEqual([7]);
    expect(
      titleEdit("Fix it @urgent", task({ labels: [{ id: 7, title: "urgent" }] }), context)
        .addLabelIds,
    ).toEqual([]);
  });

  it("refuses to save a phrase that leaves no name behind", () => {
    const edit = titleEdit("tomorrow", task(), context);
    expect(edit.problem).toBe("A task needs a name.");
    expect(edit.values).toBeNull();
  });

  it("refuses an empty field for the same reason", () => {
    expect(titleEdit("   ", task(), context).problem).toBe("A task needs a name.");
  });

  it("passes the acceptor's warnings through untouched", () => {
    const edit = titleEdit("Pay rent this weekend", task(), context);
    expect(edit.warnings[0]).toContain("this weekend");
    // Out of grammar: the words stay in the name and no date is invented.
    expect(edit.values?.title).toBe("Pay rent this weekend");
    expect(edit.values?.due_date).toBeUndefined();
  });

  it("previews what Save would do, whether or not the column changes", () => {
    const edit = titleEdit("Call mum tomorrow #Work", task(), context);
    expect(edit.preview.dueDate?.toISOString()).toBe("2026-09-16T18:00:00.000Z");
    expect(edit.preview.projectId).toBe(3);
    expect(edit.preview.title).toBe("Call mum");
  });
});
