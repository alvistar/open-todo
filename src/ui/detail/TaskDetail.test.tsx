import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskPatch } from "../../api/endpoints";
import type { Task, TaskReminder } from "../../api/types";
import { dueDateFromPhrase } from "../../model/duePhrase";
import { TaskDetail } from "./TaskDetail";

const PROJECTS = [
  { id: 1, title: "Inbox" },
  { id: 3, title: "Work" },
  { id: 7, title: "Home" },
];

/** The real acceptor, with the test's clock: the picker's phrases are not mocked. */
const readDuePhrase = (phrase: string) =>
  dueDateFromPhrase(phrase, {
    now: NOW,
    timeZone: "Europe/Rome",
    defaultDueTime: null,
    defaultProjectId: 1,
    projects: [],
    labels: [],
  });

/*
 * The first test in this repo that drives a dialog. It pins the things a modal
 * is judged on and that nothing here had ever asserted: where the focus lands,
 * where it goes back to, that Escape and the backdrop close it, and that Tab
 * cannot walk out into the list behind the overlay.
 */

const NOW = new Date("2026-09-09T08:00:00Z");

const task = (over: Partial<Task> = {}): Task => ({
  id: 91,
  title: "Water the plants",
  done: false,
  project_id: 3,
  created: "2026-09-01T10:00:00Z",
  updated: "2026-09-14T10:00:00Z",
  ...over,
});

interface Extras {
  onPrev?: () => void;
  onNext?: () => void;
  onSave?: (values: TaskPatch) => Promise<void>;
  onSaveReminders?: (reminders: TaskReminder[]) => Promise<void>;
}

function open(over: Partial<Task> = {}, extra: Extras = {}) {
  const onClose = vi.fn();
  const onSave = extra.onSave ?? vi.fn(async () => {});
  const onSaveReminders = extra.onSaveReminders ?? vi.fn(async () => {});
  render(
    <TaskDetail
      task={task(over)}
      projectName="Work"
      projects={PROJECTS}
      readDuePhrase={readDuePhrase}
      now={NOW}
      timeZone="Europe/Rome"
      defaultDueTime={null}
      onClose={onClose}
      onSave={onSave}
      onSaveReminders={onSaveReminders}
      {...(extra.onPrev ? { onPrev: extra.onPrev } : {})}
      {...(extra.onNext ? { onNext: extra.onNext } : {})}
    />,
  );
  return { onClose, onSave, onSaveReminders };
}

describe("the dialog frame", () => {
  it("announces itself as a modal named after the task", () => {
    open();
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Water the plants");
  });

  it("takes the focus on open and gives it back on close", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(
      <TaskDetail
        task={task()}
        projectName="Work"
        projects={PROJECTS}
        readDuePhrase={readDuePhrase}
        now={NOW}
        timeZone="Europe/Rome"
        defaultDueTime={null}
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
        onSaveReminders={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByLabelText("Close")).toHaveFocus();

    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("closes on Escape", () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the backdrop", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText("Close the task"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the close button", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps Tab inside itself", () => {
    // The list behind is still tabbable; without the trap the focus walks out
    // under the overlay and the user types into a list they cannot see. The
    // backdrop is deliberately NOT part of the cycle: it sits outside the
    // dialog and is out of the tab order.
    open();
    const dialog = screen.getByRole("dialog");
    const inside = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    const last = inside[inside.length - 1] as HTMLElement;

    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(inside[0]).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("offers prev and next only where there is somewhere to go", () => {
    open({}, { onNext: vi.fn() });
    expect(screen.getByLabelText("Previous task")).toBeDisabled();
    expect(screen.getByLabelText("Next task")).toBeEnabled();
  });
});

describe("what it shows", () => {
  it("names the project in the breadcrumb and the sidebar", () => {
    open();
    expect(screen.getAllByText("Work")).toHaveLength(2);
  });

  it("renders the description as text, not as the HTML Vikunja stores", () => {
    open({ description: "<p>Twice a <b>week</b></p>" });
    expect(screen.getByText("Twice a week")).toBeInTheDocument();
  });

  it("says so when a field is empty rather than leaving a gap", () => {
    open();
    expect(screen.getByText("No description")).toBeInTheDocument();
    expect(screen.getByText("No date")).toBeInTheDocument();
  });

  it("shows the due date in the viewer's own words", () => {
    open({ due_date: "2026-09-10T08:00:00Z" });
    expect(screen.getByText(/Tomorrow/)).toBeInTheDocument();
  });

  it("lists sub-tasks and strikes the done ones", () => {
    open({
      related_tasks: {
        subtask: [
          { id: 1, title: "Buy the pot", done: true },
          { id: 2, title: "Fill it", done: false },
        ],
      },
    });

    expect(screen.getByText("Buy the pot")).toBeInTheDocument();
    expect(screen.getByText("Fill it")).toBeInTheDocument();
  });

  it("opens no editor until it is asked to", () => {
    open({ description: "something" });
    const named = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);

    expect(named).not.toContain("Save");
    expect(named).not.toContain("Cancel");
  });
});

describe("editing the name and the description", () => {
  it("turns the name into an editor on click, seeded with the value", () => {
    open();
    fireEvent.click(screen.getByLabelText("Edit the task name"));

    expect(screen.getByLabelText("Edit the task name")).toHaveValue("Water the plants");
  });

  it("writes only the field it edits", async () => {
    const onSave = vi.fn(async () => {});
    open({}, { onSave });

    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: "Water the ferns" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ title: "Water the ferns" }),
    );
  });

  it("throws the draft away on Cancel and writes nothing", () => {
    const onSave = vi.fn(async () => {});
    open({}, { onSave });

    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: "nonsense" },
    });
    fireEvent.click(screen.getByText("Cancel"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Water the plants")).toBeInTheDocument();
  });

  it("does NOT discard on Escape, and does not close the dialog either", () => {
    // Measured in Todoist: Escape leaves the editor alone. Here it must also
    // not reach the dialog, or one key would throw away the text AND close the
    // pane it was in.
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText("Edit the task name"));
    const editor = screen.getByLabelText("Edit the task name");
    fireEvent.change(editor, { target: { value: "still here" } });

    // Fired on the editor, which is where the user's focus is; it bubbles to
    // the dialog's own window listener, and that listener is what must ignore
    // it while a form control has the focus.
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Edit the task name")).toHaveValue("still here");
  });

  it("keeps the editor and the text when the save fails", async () => {
    // The draft is the only copy there is.
    const onSave = vi.fn(async () => {
      throw new Error("403 Forbidden");
    });
    open({}, { onSave });

    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: "kept" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText("403 Forbidden")).toBeInTheDocument());
    expect(screen.getByLabelText("Edit the task name")).toHaveValue("kept");
  });

  it("saves the description as the minimal HTML Vikunja stores", async () => {
    const onSave = vi.fn(async () => {});
    open({ description: "<p>old</p>" }, { onSave });

    fireEvent.click(screen.getByLabelText("Edit the description"));
    fireEvent.change(screen.getByLabelText("Edit the description"), {
      target: { value: "one\ntwo" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ description: "<p>one</p><p>two</p>" }),
    );
  });

  it("warns BEFORE typing when formatting would be lost", () => {
    // A description written in Veyrn with a link reads as plain text here, and
    // saving would drop the link without anyone being told.
    open({ description: '<p>See <a href="https://x">this</a></p>' });
    fireEvent.click(screen.getByLabelText("Edit the description"));

    expect(screen.getByText(/cannot keep/)).toBeInTheDocument();
  });

  it("says nothing when there is no formatting to lose", () => {
    open({ description: "<p>plain</p>" });
    fireEvent.click(screen.getByLabelText("Edit the description"));

    expect(screen.queryByText(/cannot keep/)).not.toBeInTheDocument();
  });
});

/*
 * The sidebar's commit model, measured in Todoist on 2026-09-15 and the
 * opposite of the main column's: picking writes. There is no Save here, and
 * the last two tests pin the interaction that experiment settled - a pick and
 * an open editor do not touch each other.
 */
describe("the sidebar pickers", () => {
  const openPicker = (label: string) =>
    fireEvent.click(screen.getByLabelText(`${label}: change`));

  it("writes a priority the moment it is picked, with no Save to press", async () => {
    const { onSave } = open({ priority: 0 });
    openPicker("Priority");

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "P1" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ priority: 4 }));
  });

  it("moves the task to the project that was picked", async () => {
    const { onSave } = open({ project_id: 3 });
    openPicker("Project");

    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ project_id: 7 }));
  });

  it("reads a date shortcut through the acceptor, not a date of its own", async () => {
    const { onSave } = open();
    openPicker("Date");

    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const written = (onSave as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      due_date: string;
    };
    // 2026-09-10, all-day, at the 20:00 Rome fallback of D-map-2.
    expect(written.due_date).toBe("2026-09-10T18:00:00.000Z");
  });

  it("refuses a phrase it cannot read, and writes nothing", async () => {
    const { onSave } = open();
    openPicker("Date");

    const field = screen.getByLabelText("Type a date");
    fireEvent.change(field, { target: { value: "this weekend" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText(/this weekend/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("offers to clear only a date that exists, and clears it with the null date", async () => {
    const { onSave } = open({ due_date: "2026-09-20T18:00:00Z" });
    openPicker("Date");

    fireEvent.click(screen.getByRole("button", { name: "No date" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ due_date: "0001-01-01T00:00:00Z" }),
    );
  });

  it("does not offer to clear a date that is not set", () => {
    open();
    openPicker("Date");

    expect(screen.queryByRole("button", { name: "No date" })).not.toBeInTheDocument();
  });

  it("stays open and says why when the write fails", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Vikunja said no.");
    });
    open({ priority: 0 }, { onSave });
    openPicker("Priority");
    fireEvent.click(screen.getByRole("button", { name: "P1" }));

    expect(await screen.findByText("Vikunja said no.")).toBeInTheDocument();
    // Still open: with no Save button to stay behind, closing would leave the
    // old value on screen with nothing to explain it.
    expect(screen.getByRole("button", { name: "P2" })).toBeInTheDocument();
  });

  it("gives Escape to the open picker, not to the dialog behind it", () => {
    const { onClose } = open();
    openPicker("Priority");

    fireEvent.keyDown(screen.getByRole("button", { name: "P1" }), { key: "Escape" });

    expect(screen.queryByRole("button", { name: "P1" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves an open title editor alone when the sidebar commits", async () => {
    const { onSave } = open({ priority: 0 });
    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: "Half-typed name" },
    });

    openPicker("Priority");
    fireEvent.click(screen.getByRole("button", { name: "P1" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ priority: 4 }));

    // Measured in Todoist: the pick commits, the editor keeps its draft, and
    // the editor's own Cancel does not take the pick back with it.
    expect(screen.getByLabelText("Edit the task name")).toHaveValue("Half-typed name");
  });
});

describe("the reminder picker", () => {
  const openReminders = () => fireEvent.click(screen.getByLabelText("Reminders: change"));

  const withDate = { due_date: "2026-09-20T18:00:00Z" };

  it("adds a preset to the set that is already there, not instead of it", async () => {
    const existing = [{ relative_period: -600, relative_to: "due_date" }];
    const { onSaveReminders } = open({ ...withDate, reminders: existing });
    openReminders();

    fireEvent.click(screen.getByRole("button", { name: "1 day before" }));

    // Vikunja replaces the whole list, so a partial set would delete the rest.
    await waitFor(() =>
      expect(onSaveReminders).toHaveBeenCalledWith([
        ...existing,
        { relative_period: -86_400, relative_to: "due_date" },
      ]),
    );
  });

  it("removes one reminder and keeps the others", async () => {
    const { onSaveReminders } = open({
      ...withDate,
      reminders: [
        { relative_period: -600, relative_to: "due_date" },
        { relative_period: 0, relative_to: "due_date" },
      ],
    });
    openReminders();

    fireEvent.click(
      screen.getByLabelText("Remove the reminder 10 minutes before it is due"),
    );

    await waitFor(() =>
      expect(onSaveReminders).toHaveBeenCalledWith([
        { relative_period: 0, relative_to: "due_date" },
      ]),
    );
  });

  it("will not offer an offset when there is no date to measure it from", () => {
    open();
    openReminders();

    expect(
      screen.queryByRole("button", { name: "1 day before" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Give the task a date/)).toBeInTheDocument();
  });

  it("takes an absolute reminder through the same grammar as the date field", async () => {
    const { onSaveReminders } = open();
    openReminders();

    const field = screen.getByLabelText("Remind me at");
    fireEvent.change(field, { target: { value: "tomorrow at 9" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onSaveReminders).toHaveBeenCalledTimes(1));
    expect(onSaveReminders).toHaveBeenCalledWith([
      { reminder: "2026-09-10T07:00:00.000Z" },
    ]);
  });

  it("refuses a phrase it cannot read, and writes nothing", async () => {
    const { onSaveReminders } = open();
    openReminders();

    const field = screen.getByLabelText("Remind me at");
    fireEvent.change(field, { target: { value: "sometime soonish" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText(/sometime soonish/)).toBeInTheDocument();
    expect(onSaveReminders).not.toHaveBeenCalled();
  });
});
