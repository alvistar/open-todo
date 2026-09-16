/*
 * The sidebar of the task dialog commits on pick — no Save, no Cancel (D-detail,
 * settled by experiment on the reference product). That is the right shape, and
 * it is exactly why those writes need an Undo: there is no moment at which the
 * pick can be taken back, and two of them (project, date) can carry the task
 * out of the view it was opened from, so the row is gone as well.
 *
 * What is pinned here is the pair a toast needs: what to SAY, and what to write
 * to put it back. The previous value is taken from the server's own copy of the
 * task — never reconstructed — which is the rule D-write and D-vocab both keep:
 * the app does not invent a value and present it as one the user had.
 */
import { describe, expect, it } from "vitest";
import { type Task, VIKUNJA_NULL_DATE } from "../api/types";
import {
  undoableChange,
  undoableLabelChange,
  undoableReminderChange,
} from "./undoableChange";

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: "t",
    done: false,
    project_id: 3,
    priority: 0,
    created: "2026-09-01T00:00:00Z",
    updated: "2026-09-01T00:00:00Z",
    ...over,
  }) as Task;

const context = {
  projectName: (id: number) => (id === 9 ? "Lavoro" : "Personale"),
  describeDue: (iso: string) => (iso.startsWith("2026-09-17") ? "Tomorrow" : iso),
};

describe("moving a task to another project", () => {
  it("says where it went and remembers where it was", () => {
    const change = undoableChange(task({ project_id: 3 }), { project_id: 9 }, context);
    expect(change).toEqual({
      message: "Moved to Lavoro",
      previous: { project_id: 3 },
    });
  });

  it("is not offered when the pick changes nothing", () => {
    // Picking the project a task is already in is not an event, and a toast
    // for it would be a toast the reader learns to ignore.
    expect(
      undoableChange(task({ project_id: 3 }), { project_id: 3 }, context),
    ).toBeNull();
  });
});

describe("rescheduling", () => {
  it("names the new date and keeps the old one", () => {
    const change = undoableChange(
      task({ due_date: "2026-09-20T09:00:00Z" }),
      { due_date: "2026-09-17T09:00:00Z" },
      context,
    );
    expect(change?.message).toBe("Rescheduled to Tomorrow");
    expect(change?.previous).toEqual({ due_date: "2026-09-20T09:00:00Z" });
  });

  it("puts back a date that was cleared", () => {
    const change = undoableChange(
      task({ due_date: "2026-09-20T09:00:00Z" }),
      { due_date: VIKUNJA_NULL_DATE },
      context,
    );
    expect(change?.message).toBe("Date removed");
    expect(change?.previous).toEqual({ due_date: "2026-09-20T09:00:00Z" });
  });

  it("undoes a date ADDED to a task that had none by clearing it again", () => {
    // Mapping §6 item 16: the way to say "no date" is to write Vikunja's null
    // date. Omitting the column would leave the new one in place, because
    // under the bulk route an unnamed column is re-read from the stored row.
    const change = undoableChange(
      task({}),
      { due_date: "2026-09-17T09:00:00Z" },
      context,
    );
    expect(change?.previous).toEqual({ due_date: VIKUNJA_NULL_DATE });
  });

  it("treats Vikunja's null date as no date on the way in too", () => {
    const change = undoableChange(
      task({ due_date: VIKUNJA_NULL_DATE }),
      { due_date: VIKUNJA_NULL_DATE },
      context,
    );
    expect(change).toBeNull();
  });
});

describe("priority", () => {
  it("names the level in the app's own scale, not Vikunja's", () => {
    // D-map-1: Vikunja counts 0-5 upwards, the UI counts P1-P4 downwards.
    // A toast saying "Priority set to 4" for a P1 would be a lie in a language
    // the user does not speak.
    const change = undoableChange(task({ priority: 0 }), { priority: 4 }, context);
    expect(change?.message).toBe("Priority set to P1");
    expect(change?.previous).toEqual({ priority: 0 });
  });

  it("says so when the priority is taken away", () => {
    const change = undoableChange(task({ priority: 4 }), { priority: 0 }, context);
    expect(change?.message).toBe("Priority removed");
    expect(change?.previous).toEqual({ priority: 4 });
  });
});

describe("what is deliberately not offered", () => {
  it("ignores the fields that have their own way back", () => {
    // Title and description live in the main column, which has a Cancel;
    // `done` has the row linger of D-write. Offering a second Undo for those
    // would be two mechanisms disagreeing about the same action.
    expect(undoableChange(task(), { title: "new" }, context)).toBeNull();
    expect(undoableChange(task(), { description: "<p>x</p>" }, context)).toBeNull();
    expect(undoableChange(task(), { done: true }, context)).toBeNull();
  });

  it("ignores a write that names more than one sidebar field", () => {
    /*
     * Not laziness: no picker writes two at once, so this can only mean a
     * caller this function was not designed for. Describing it as one of them
     * would put a message on screen that does not match what happened, and an
     * Undo that only half works.
     */
    expect(undoableChange(task(), { project_id: 9, priority: 4 }, context)).toBeNull();
  });
});

describe("labels", () => {
  const name = (id: number) => (id === 5 ? "telefono" : "urgente");

  it("takes back an attach by detaching the same label", () => {
    expect(undoableLabelChange({ labelId: 5, attached: true }, name)).toEqual({
      message: "Added @telefono",
      previous: { labelId: 5, attached: false },
    });
  });

  it("takes back a detach by attaching it again", () => {
    expect(undoableLabelChange({ labelId: 5, attached: false }, name)).toEqual({
      message: "Removed @telefono",
      previous: { labelId: 5, attached: true },
    });
  });

  it("offers NOTHING for creating a label", () => {
    /*
     * The one that must not be offered. Creating a label puts it in a
     * namespace shared by every task in the instance, so undoing it means
     * deleting something another task may already carry — and D-detail already
     * made creation a deliberate button precisely because a typo there is not
     * undoable by the person who made it. An Undo would be that keystroke with
     * a friendlier face.
     */
    expect(undoableLabelChange({ create: "nuovo" }, name)).toBeNull();
  });

  it("says nothing it cannot name", () => {
    // A label the list does not have yet: better no toast than "Added @5".
    expect(
      undoableLabelChange({ labelId: 99, attached: true }, () => undefined),
    ).toBeNull();
  });
});

describe("reminders", () => {
  const before = [{ relative_period: -3600, relative_to: "due_date" }];
  const describe1 = () => "1 hour before";

  it("puts the old list back, whole", () => {
    // Reminders are replaced as a set, never patched (§6 item 17 is what
    // happens when you try), so the only honest undo is the previous set.
    const change = undoableReminderChange(before, [], describe1);
    expect(change).toEqual({ message: "Reminders cleared", previous: before });
  });

  it("names a single reminder rather than counting it", () => {
    expect(undoableReminderChange([], before, describe1)?.message).toBe(
      "Reminder set: 1 hour before",
    );
  });

  it("counts several", () => {
    const two = [...before, { reminder: "2026-09-20T09:00:00Z" }];
    expect(undoableReminderChange([], two, describe1)?.message).toBe("2 reminders set");
  });

  it("is not offered when the set did not change", () => {
    expect(undoableReminderChange(before, before, describe1)).toBeNull();
    expect(undoableReminderChange([], [], describe1)).toBeNull();
  });
});
