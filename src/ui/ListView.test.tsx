import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskRowModel } from "../model/display";
import { ListView, type TaskSection } from "./ListView";

/*
 * D4 step 2, the focus model. Every row used to be tabbable and each carries a
 * checkbox button of its own, so stepping past a fifty-task list took over a
 * hundred Tab presses - keyboard support that nobody could use. The list now
 * owns one tab stop and the arrows move inside it.
 */

const row = (id: number, over: Partial<TaskRowModel> = {}): TaskRowModel => ({
  id,
  title: `Task ${id}`,
  priority: 4,
  done: false,
  ...over,
});

const sections = (...tasks: TaskRowModel[]): TaskSection[] => [
  { key: "a", tasks: tasks.slice(0, 2) },
  { key: "b", tasks: tasks.slice(2) },
];

/** The row elements, in the order they are rendered. */
const rowsOf = () =>
  screen
    .getAllByRole("button")
    .filter(
      (el) =>
        el.tabIndex !== undefined && el.getAttribute("aria-label")?.startsWith("Task "),
    );

describe("one tab stop, arrows inside", () => {
  it("makes only the first row reachable by Tab", () => {
    render(<ListView sections={sections(row(1), row(2), row(3))} />);
    const rows = rowsOf();

    expect(rows.map((el) => el.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves the tab stop and the focus with ArrowDown", () => {
    render(<ListView sections={sections(row(1), row(2), row(3))} />);
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown" });

    const rows = rowsOf();
    expect(rows.map((el) => el.tabIndex)).toEqual([-1, 0, -1]);
    expect(rows[1]).toHaveFocus();
  });

  it("crosses a section boundary, because the order is the whole list", () => {
    render(<ListView sections={sections(row(1), row(2), row(3))} />);
    const start = rowsOf()[0] as HTMLElement;
    fireEvent.keyDown(start, { key: "ArrowDown" });
    fireEvent.keyDown(start, { key: "ArrowDown" });

    expect(rowsOf()[2]).toHaveFocus();
  });

  it("stops at the ends rather than wrapping", () => {
    render(<ListView sections={sections(row(1), row(2))} />);
    const start = rowsOf()[0] as HTMLElement;

    fireEvent.keyDown(start, { key: "ArrowUp" });
    expect(rowsOf()[0]?.tabIndex).toBe(0);

    fireEvent.keyDown(start, { key: "ArrowDown" });
    fireEvent.keyDown(start, { key: "ArrowDown" });
    expect(rowsOf()[1]?.tabIndex).toBe(0);
  });
});

describe("acting on the focused row", () => {
  it("completes it with Enter", () => {
    const onToggleDone = vi.fn();
    render(<ListView sections={sections(row(1), row(2))} onToggleDone={onToggleDone} />);
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown" });
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "Enter" });

    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("undoes with u, but only while the row can be undone", () => {
    const onUndo = vi.fn();
    render(
      <ListView
        sections={sections(row(1, { done: true, undoable: true }), row(2))}
        onUndo={onUndo}
      />,
    );
    const first = rowsOf()[0] as HTMLElement;

    fireEvent.keyDown(first, { key: "u" });
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));

    // The handler lives on each row, so pressing u on a row with nothing to
    // undo is the second half of the rule.
    onUndo.mockClear();
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "u" });
    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("the composer shares this container", () => {
  it("never sees keys typed into the footer", () => {
    /*
     * The quick-add composer renders in the footer, INSIDE the scroll
     * container. This is why the key handler is attached to each ROW rather
     * than to the container: up there it would also see every keystroke typed
     * into a task name, and "u" would undo while you were spelling "usare".
     * The test guards the placement, not the guard clause it replaced.
     */
    const onToggleDone = vi.fn();
    const onUndo = vi.fn();
    render(
      <ListView
        sections={sections(row(1, { done: true, undoable: true }), row(2))}
        onToggleDone={onToggleDone}
        onUndo={onUndo}
        footer={<textarea aria-label="Task name" />}
      />,
    );
    const input = screen.getByLabelText("Task name");

    fireEvent.keyDown(input, { key: "u" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onToggleDone).not.toHaveBeenCalled();
  });
});
