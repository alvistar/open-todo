import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function open(
  over: Partial<Task> = {},
  props: Partial<Parameters<typeof TaskDetail>[0]> = {},
) {
  const onClose = vi.fn();
  render(
    <TaskDetail
      task={task(over)}
      projectName="Work"
      now={NOW}
      timeZone="Europe/Rome"
      defaultDueTime={null}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
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

  it("offers no control it cannot honour yet", () => {
    // Editing arrives field by field. Until then the dialog must not paint a
    // button that does nothing - this app has shipped two of those already.
    open({ description: "something" });
    const named = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);

    expect(named.filter((n) => n?.startsWith("Complete"))).toHaveLength(1);
    expect(named).not.toContain("Save");
  });
});
