import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskRowModel } from "../model/display";
import { TaskRow } from "./TaskRow";

/*
 * The row's half of D-write. The hook tests pin WHAT the pending map holds;
 * nothing pinned that the row paints it - and an Undo that never reaches the
 * screen is the same as no Undo, since a completed task is otherwise
 * unreachable from this app.
 */

const row = (over: Partial<TaskRowModel> = {}): TaskRowModel => ({
  id: 91,
  title: "Water the plants",
  priority: 4,
  done: false,
  ...over,
});

describe("the completion checkbox", () => {
  it("reports the task, and does not also open it", () => {
    const onToggleDone = vi.fn();
    const onOpen = vi.fn();
    render(<TaskRow task={row()} onToggleDone={onToggleDone} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: /^Complete/ }));

    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: 91 }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is disabled when nothing is listening, as in the read-only slice", () => {
    render(<TaskRow task={row()} />);
    expect(screen.getByRole("button", { name: /^Complete/ })).toBeDisabled();
  });

  it("offers to reopen a done task rather than complete it again", () => {
    render(<TaskRow task={row({ done: true })} onToggleDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Reopen/ })).toBeInTheDocument();
  });
});

describe("the transient note", () => {
  it("paints what just happened to a repeating task", () => {
    render(<TaskRow task={row({ note: "Done. Next: 17 Sep" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Done. Next: 17 Sep");
  });

  it("carries the full text in the title, since the row ellipsises it", () => {
    const message = "The change could not be saved: 403 Forbidden on project 3.";
    render(<TaskRow task={row({ note: message })} />);
    expect(screen.getByRole("status")).toHaveAttribute("title", message);
  });

  it("is absent when there is nothing to say", () => {
    render(<TaskRow task={row()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Undo", () => {
  it("appears on a completed row and reports the task", () => {
    const onUndo = vi.fn();
    render(<TaskRow task={row({ done: true, undoable: true })} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 91 }));
  });

  it("does not also open the task", () => {
    const onOpen = vi.fn();
    render(
      <TaskRow
        task={row({ done: true, undoable: true })}
        onUndo={vi.fn()}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("stays away from a repeating task, whose old date is gone for good", () => {
    render(<TaskRow task={row({ note: "Done. Next: 17 Sep" })} onUndo={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
