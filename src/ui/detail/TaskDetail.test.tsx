import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskPatch } from "../../api/endpoints";
import type { Task, TaskReminder } from "../../api/types";
import { dueDateFromPhrase } from "../../model/duePhrase";
import { titleEdit } from "../../model/titleEdit";
import type { LabelChange } from "./pickers";
import { TaskDetail } from "./TaskDetail";

const COMMENTS = [
  {
    id: 5,
    comment: "<p>Rang them, no answer.</p>",
    author: { id: 2, username: "sam", created: "", updated: "" },
    created: "2026-09-08T09:30:00Z",
    updated: "2026-09-08T09:30:00Z",
  },
];

const ALL_LABELS = [
  { id: 1, title: "errand" },
  { id: 2, title: "reading" },
  { id: 3, title: "urgent" },
];

const PROJECTS = [
  { id: 1, title: "Inbox" },
  { id: 3, title: "Work" },
  { id: 7, title: "Home" },
];

const readTitleEdit = (raw: string) => titleEdit(raw, task(), CONTEXT);

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

const CONTEXT = {
  now: NOW,
  timeZone: "Europe/Rome",
  defaultDueTime: null,
  defaultProjectId: 1,
  projects: [{ id: 7, title: "Home" }],
  labels: [{ id: 3, title: "urgent" }],
};

/** The real reader, so the preview is the one the app actually computes. */

interface Extras {
  onPrev?: () => void;
  onNext?: () => void;
  onSave?: (values: TaskPatch) => Promise<void>;
  onSaveReminders?: (reminders: TaskReminder[]) => Promise<void>;
  onChangeLabel?: (change: LabelChange) => Promise<void>;
  onSaveTitle?: (raw: string) => Promise<void>;
  onAddComment?: (html: string) => Promise<void>;
  onAddSubtask?: (title: string) => Promise<void>;
}

function open(over: Partial<Task> = {}, extra: Extras = {}) {
  const onClose = vi.fn();
  const onSave = extra.onSave ?? vi.fn(async () => {});
  const onSaveReminders = extra.onSaveReminders ?? vi.fn(async () => {});
  const onChangeLabel = extra.onChangeLabel ?? vi.fn(async () => {});
  const onSaveTitle = extra.onSaveTitle ?? vi.fn(async () => {});
  const onAddComment = extra.onAddComment ?? vi.fn(async () => {});
  const onAddSubtask = extra.onAddSubtask ?? vi.fn(async () => {});
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
      allLabels={ALL_LABELS}
      onChangeLabel={onChangeLabel}
      readTitleEdit={readTitleEdit}
      onSaveTitle={onSaveTitle}
      comments={COMMENTS}
      commentsLoading={false}
      onAddComment={onAddComment}
      onAddSubtask={onAddSubtask}
      {...(extra.onPrev ? { onPrev: extra.onPrev } : {})}
      {...(extra.onNext ? { onNext: extra.onNext } : {})}
    />,
  );
  return {
    onClose,
    onSave,
    onSaveReminders,
    onChangeLabel,
    onSaveTitle,
    onAddComment,
    onAddSubtask,
  };
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
        allLabels={ALL_LABELS}
        onChangeLabel={vi.fn(async () => {})}
        readTitleEdit={readTitleEdit}
        onSaveTitle={vi.fn(async () => {})}
        comments={[]}
        commentsLoading={false}
        onAddComment={vi.fn(async () => {})}
        onAddSubtask={vi.fn(async () => {})}
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

  it("hands the raw name to its own save, phrase and all", async () => {
    const { onSaveTitle, onSave } = open();

    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: "Water the ferns tomorrow" },
    });
    fireEvent.click(screen.getByText("Save"));

    /*
     * RAW, not the parsed columns. The screen re-reads the phrase with a fresh
     * clock before writing, because a preview computed at the last keystroke
     * could be a day stale in a tab left open overnight.
     */
    await waitFor(() =>
      expect(onSaveTitle).toHaveBeenCalledWith("Water the ferns tomorrow"),
    );
    expect(onSave).not.toHaveBeenCalled();
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
    const onSaveTitle = vi.fn(async () => {
      throw new Error("403 Forbidden");
    });
    open({}, { onSaveTitle });

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

describe("the label picker", () => {
  const openLabels = () => fireEvent.click(screen.getByLabelText("Labels: change"));

  it("attaches one label per pick, because that is one call", async () => {
    const { onChangeLabel } = open();
    openLabels();

    fireEvent.click(screen.getByLabelText("Add the label urgent"));

    await waitFor(() =>
      expect(onChangeLabel).toHaveBeenCalledWith({ labelId: 3, attached: true }),
    );
  });

  it("detaches one that is already on the task", async () => {
    const { onChangeLabel } = open({ labels: [{ id: 2, title: "reading" }] });
    openLabels();

    fireEvent.click(screen.getByLabelText("Remove the label reading"));

    await waitFor(() =>
      expect(onChangeLabel).toHaveBeenCalledWith({ labelId: 2, attached: false }),
    );
  });

  it("does not offer a label the task already carries", () => {
    open({ labels: [{ id: 2, title: "reading" }] });
    openLabels();

    expect(screen.queryByLabelText("Add the label reading")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add the label urgent")).toBeInTheDocument();
  });

  it("filters by what is typed, and says so when nothing matches", () => {
    open();
    openLabels();

    fireEvent.change(screen.getByLabelText("Find a label"), {
      target: { value: "urg" },
    });
    expect(screen.getByLabelText("Add the label urgent")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add the label errand")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Find a label"), {
      target: { value: "nothing like this" },
    });
    expect(screen.queryByLabelText("Add the label urgent")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create .*nothing like this/ }),
    ).toBeInTheDocument();
  });

  it("says a name is already on the task rather than calling it no match", () => {
    open({ labels: [{ id: 2, title: "reading" }] });
    openLabels();

    fireEvent.change(screen.getByLabelText("Find a label"), {
      target: { value: "reading" },
    });

    // It matches perfectly; it is just not offerable. "No match" would send
    // the reader looking for a label that is in front of them.
    expect(screen.getByText(/already on this task/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("tells an instance with no labels how to get one", () => {
    render(
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
        allLabels={[]}
        onChangeLabel={vi.fn(async () => {})}
        readTitleEdit={readTitleEdit}
        onSaveTitle={vi.fn(async () => {})}
        comments={[]}
        commentsLoading={false}
        onAddComment={vi.fn(async () => {})}
        onAddSubtask={vi.fn(async () => {})}
      />,
    );
    fireEvent.click(screen.getByLabelText("Labels: change"));

    expect(screen.getByText(/No labels yet/)).toBeInTheDocument();
  });

  it("creates a label by name, on a button press and never on a keystroke", async () => {
    const { onChangeLabel } = open();
    openLabels();

    const field = screen.getByLabelText("Find a label");
    fireEvent.change(field, { target: { value: "  gardening  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChangeLabel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Create .*gardening/ }));
    await waitFor(() =>
      expect(onChangeLabel).toHaveBeenCalledWith({ create: "gardening" }),
    );
  });

  it("will not offer to create a name that already exists", () => {
    open();
    openLabels();

    fireEvent.change(screen.getByLabelText("Find a label"), {
      target: { value: "URGENT" },
    });

    // Vikunja does not enforce unique titles, so this is the only thing
    // stopping an instance growing two labels called "urgent".
    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add the label urgent")).toBeInTheDocument();
  });
});

/*
 * The sidebar as the feedback channel. The owner chose it over chips beside
 * the field, so what it says while a name is being typed IS the whole preview,
 * and these tests are what stop it going quiet.
 */
describe("the name being typed, previewed in the sidebar", () => {
  const typeName = (text: string) => {
    fireEvent.click(screen.getByLabelText("Edit the task name"));
    fireEvent.change(screen.getByLabelText("Edit the task name"), {
      target: { value: text },
    });
  };

  it("shows the date the phrase would set, before Save is pressed", () => {
    open();
    expect(screen.getByLabelText("Date: change")).toHaveTextContent("No date");

    typeName("Call mum tomorrow");

    const date = screen.getByLabelText("Date: change");
    expect(date).toHaveTextContent("Tomorrow");
    // And says so to a reader who cannot see the colour.
    expect(date).toHaveTextContent("when you save");
  });

  it("shows the project the phrase would move it to", () => {
    open({ project_id: 3 });
    typeName("Call mum #Home");

    expect(screen.getByLabelText("Project: change")).toHaveTextContent("Home");
  });

  it("shows a label the phrase would add, alongside the ones already there", () => {
    open({ labels: [{ id: 2, title: "reading" }] });
    typeName("Fix it @urgent");

    const row = screen.getByLabelText("Labels: change");
    expect(row).toHaveTextContent("reading");
    expect(row).toHaveTextContent("urgent");
  });

  it("goes back to the stored values when the edit is cancelled", () => {
    open();
    typeName("Call mum tomorrow");
    expect(screen.getByLabelText("Date: change")).toHaveTextContent("Tomorrow");

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getByLabelText("Date: change")).toHaveTextContent("No date");
  });

  it("marks nothing when the phrase names nothing", () => {
    open();
    typeName("Just a plain name");

    expect(screen.getByLabelText("Date: change")).not.toHaveTextContent("when you save");
  });

  it("paints the acceptor's warning while the phrase is out of grammar", () => {
    open();
    typeName("Pay rent this weekend");

    expect(screen.getByText(/this weekend/)).toBeInTheDocument();
    // D-vocab: the words stay in the name and no date is invented.
    expect(screen.getByLabelText("Date: change")).toHaveTextContent("No date");
  });
});

describe("comments", () => {
  it("shows who said what, and when", () => {
    open();

    expect(screen.getByText("Rang them, no answer.")).toBeInTheDocument();
    expect(screen.getByText("sam")).toBeInTheDocument();
  });

  it("sends what was typed as the minimal HTML Vikunja stores", async () => {
    const { onAddComment } = open();

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "Tried again\nstill nothing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(onAddComment).toHaveBeenCalledWith("<p>Tried again</p><p>still nothing</p>"),
    );
  });

  it("will not send an empty comment", () => {
    const { onAddComment } = open();

    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
    expect(onAddComment).not.toHaveBeenCalled();
  });

  it("keeps the text when sending fails", async () => {
    const onAddComment = vi.fn(async () => {
      throw new Error("500 Server Error");
    });
    open({}, { onAddComment });

    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: "worth keeping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("500 Server Error")).toBeInTheDocument();
    // The box is cleared on success only: a failed send must not eat the text.
    expect(screen.getByLabelText("Add a comment")).toHaveValue("worth keeping");
  });

  it("says when a comment was written with formatting it cannot show", () => {
    render(
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
        allLabels={ALL_LABELS}
        onChangeLabel={vi.fn(async () => {})}
        readTitleEdit={readTitleEdit}
        onSaveTitle={vi.fn(async () => {})}
        comments={[
          {
            id: 9,
            comment: '<p>See <a href="https://x">this</a></p>',
            created: "2026-09-08T09:30:00Z",
            updated: "2026-09-08T09:30:00Z",
          },
        ]}
        commentsLoading={false}
        onAddComment={vi.fn(async () => {})}
        onAddSubtask={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText(/formatting open-todo cannot show/)).toBeInTheDocument();
  });
});

describe("sub-tasks", () => {
  it("adds one by name on Enter", async () => {
    const { onAddSubtask } = open();

    const field = screen.getByLabelText("Add a sub-task");
    fireEvent.change(field, { target: { value: "  Buy the paint  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onAddSubtask).toHaveBeenCalledWith("Buy the paint"));
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("will not add an empty one", () => {
    const { onAddSubtask } = open();

    const field = screen.getByLabelText("Add a sub-task");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onAddSubtask).not.toHaveBeenCalled();
  });

  it("keeps the name when the add fails", async () => {
    const onAddSubtask = vi.fn(async () => {
      throw new Error("409 Conflict");
    });
    open({}, { onAddSubtask });

    const field = screen.getByLabelText("Add a sub-task");
    fireEvent.change(field, { target: { value: "worth keeping" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText("409 Conflict")).toBeInTheDocument();
    expect(field).toHaveValue("worth keeping");
  });

  it("offers the box even on a task that has none yet", () => {
    open();
    expect(screen.getByLabelText("Add a sub-task")).toBeInTheDocument();
  });
});
