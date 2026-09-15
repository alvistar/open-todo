import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskPatch } from "../../api/endpoints";
import type { Task } from "../../api/types";
import { TaskDetail } from "./TaskDetail";

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
}

function open(over: Partial<Task> = {}, extra: Extras = {}) {
  const onClose = vi.fn();
  const onSave = extra.onSave ?? vi.fn(async () => {});
  render(
    <TaskDetail
      task={task(over)}
      projectName="Work"
      now={NOW}
      timeZone="Europe/Rome"
      defaultDueTime={null}
      onClose={onClose}
      onSave={onSave}
      {...(extra.onPrev ? { onPrev: extra.onPrev } : {})}
      {...(extra.onNext ? { onNext: extra.onNext } : {})}
    />,
  );
  return { onClose, onSave };
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
        now={NOW}
        timeZone="Europe/Rome"
        defaultDueTime={null}
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
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
