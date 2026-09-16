import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastRegion } from "./ToastRegion";
import type { Toast } from "./useToasts";

const toast = (over: Partial<Toast> = {}): Toast => ({
  id: 1,
  message: "Moved to Lavoro",
  kind: "info",
  ...over,
});

const render1 = (toasts: Toast[], dismiss = vi.fn()) => {
  render(<ToastRegion toasts={toasts} dismiss={dismiss} show={vi.fn()} />);
  return dismiss;
};

describe("the toast region", () => {
  it("renders nothing at all when there is nothing to say", () => {
    const { container } = render(
      <ToastRegion toasts={[]} dismiss={vi.fn()} show={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("announces a confirmation politely and a failure as an alert", () => {
    // A failure interrupts; a confirmation does not. Anything carrying an
    // action is polite too — cutting across a reader to offer them an Undo is
    // the opposite of helpful.
    render1([toast(), toast({ id: 2, kind: "error", message: "Not moved: nope" })]);
    expect(screen.getByRole("status")).toHaveTextContent("Moved to Lavoro");
    expect(screen.getByRole("alert")).toHaveTextContent("Not moved: nope");
  });

  it("runs the action and takes the toast away, in that order", () => {
    const dismiss = vi.fn();
    const run = vi.fn();
    render1([toast({ action: { label: "Undo", run } })], dismiss);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(run).toHaveBeenCalledTimes(1);
    // Dismissed as well, so a slow write does not leave a button that can be
    // pressed twice — the second press would undo the undo.
    expect(dismiss).toHaveBeenCalledWith(1);
  });

  it("can always be got rid of, named so it is clear which one", () => {
    const dismiss = render1([toast()]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Moved to Lavoro" }));
    expect(dismiss).toHaveBeenCalledWith(1);
  });

  it("shows no action button when there is nothing to undo", () => {
    render1([toast()]);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
