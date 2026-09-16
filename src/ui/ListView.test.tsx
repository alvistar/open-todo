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

describe("j and k alias the arrows", () => {
  // Measured from Todoist's own shortcut panel, which lists "↑ oppure K".
  it("moves the focus the same way", () => {
    render(<ListView sections={sections(row(1), row(2), row(3))} />);
    const start = rowsOf()[0] as HTMLElement;

    fireEvent.keyDown(start, { key: "j" });
    expect(rowsOf()[1]).toHaveFocus();

    fireEvent.keyDown(start, { key: "k" });
    expect(rowsOf()[0]).toHaveFocus();
  });
});

describe("acting on the focused row", () => {
  it("OPENS it with Enter, which is what Enter means in the oracle", () => {
    const onOpenTask = vi.fn();
    const onToggleDone = vi.fn();
    render(
      <ListView
        sections={sections(row(1), row(2))}
        onOpenTask={onOpenTask}
        onToggleDone={onToggleDone}
      />,
    );
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown" });
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "Enter" });

    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(onToggleDone).not.toHaveBeenCalled();
  });

  it("does nothing on Enter when there is nowhere to open", () => {
    // The rule this app keeps relearning: a key that announces an action and
    // performs none is worse than no key at all.
    const onToggleDone = vi.fn();
    render(<ListView sections={sections(row(1), row(2))} onToggleDone={onToggleDone} />);
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "Enter" });

    expect(onToggleDone).not.toHaveBeenCalled();
  });

  it("completes it with e", () => {
    const onToggleDone = vi.fn();
    render(<ListView sections={sections(row(1), row(2))} onToggleDone={onToggleDone} />);
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown" });
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "e" });

    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("undoes with z, but only while the row can be undone", () => {
    const onUndo = vi.fn();
    render(
      <ListView
        sections={sections(row(1, { done: true, undoable: true }), row(2))}
        onUndo={onUndo}
      />,
    );
    const first = rowsOf()[0] as HTMLElement;

    fireEvent.keyDown(first, { key: "z" });
    expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));

    // The handler lives on each row, so pressing z on a row with nothing to
    // undo is the second half of the rule.
    onUndo.mockClear();
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "z" });
    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("the composer shares this container", () => {
  it("never sees keys typed into the footer", () => {
    /*
     * The quick-add composer renders in the footer, INSIDE the scroll
     * container. This is why the key handler is attached to each ROW rather
     * than to the container: up there it would also see every keystroke typed
     * into a task name, and "z" would undo while you were spelling "zuppa".
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

    fireEvent.keyDown(input, { key: "z" });
    fireEvent.keyDown(input, { key: "e" });
    fireEvent.keyDown(input, { key: "j" });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onToggleDone).not.toHaveBeenCalled();
  });
});

/*
 * D4 step 3, the keyboard half. The gesture arrives with dnd-kit, but the
 * binding lands first: it is the one path that works in jsdom, so it is what
 * pins the contract the drop handler will share.
 */
describe("Alt+Arrow moves a row", () => {
  const flat = (...tasks: TaskRowModel[]): TaskSection[] => [{ key: "a", tasks }];

  it("asks to move the focused row down", () => {
    const onReorder = vi.fn();
    render(
      <ListView
        sections={flat(row(1), row(2), row(3))}
        reorderable
        onReorder={onReorder}
      />,
    );
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "ArrowDown", altKey: true });
    expect(onReorder).toHaveBeenCalledWith(2, 3);
  });

  it("asks to move it up", () => {
    const onReorder = vi.fn();
    render(
      <ListView
        sections={flat(row(1), row(2), row(3))}
        reorderable
        onReorder={onReorder}
      />,
    );
    fireEvent.keyDown(rowsOf()[2] as HTMLElement, { key: "ArrowUp", altKey: true });
    expect(onReorder).toHaveBeenCalledWith(3, 2);
  });

  it("does nothing at the ends", () => {
    const onReorder = vi.fn();
    render(
      <ListView sections={flat(row(1), row(2))} reorderable onReorder={onReorder} />,
    );
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(rowsOf()[1] as HTMLElement, { key: "ArrowDown", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("stays silent on a list with no order to write to", () => {
    // Nothing is painted that cannot be honoured: a view without a position
    // space gets no handle, and its keyboard equivalent must agree.
    const onReorder = vi.fn();
    render(<ListView sections={flat(row(1), row(2))} onReorder={onReorder} />);
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown", altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("leaves the plain arrows moving the focus and nothing else", () => {
    const onReorder = vi.fn();
    render(
      <ListView
        sections={flat(row(1), row(2), row(3))}
        reorderable
        onReorder={onReorder}
      />,
    );
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
    expect(rowsOf()[1]).toHaveFocus();
  });

  it("does not move a row when Alt arrives with another modifier", () => {
    // Alt+Cmd+Arrow is a window-manager gesture on more than one desktop; a
    // list that reorders underneath one would be reordering by accident.
    const onReorder = vi.fn();
    render(
      <ListView
        sections={flat(row(1), row(2), row(3))}
        reorderable
        onReorder={onReorder}
      />,
    );
    fireEvent.keyDown(rowsOf()[0] as HTMLElement, {
      key: "ArrowDown",
      altKey: true,
      metaKey: true,
    });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
