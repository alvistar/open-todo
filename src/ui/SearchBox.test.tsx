import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox";

afterEach(cleanup);

const input = () => screen.getByLabelText("Search tasks") as HTMLInputElement;

describe("SearchBox", () => {
  it("searches on submit, not on every keystroke", () => {
    // Searching as you type would walk the instance once per character and
    // push a history entry per character, since the URL is the state.
    const onSearch = vi.fn();
    render(<SearchBox query="" onSearch={onSearch} />);

    fireEvent.change(input(), { target: { value: "notaio" } });
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.submit(input().closest("form") as HTMLFormElement);
    expect(onSearch).toHaveBeenCalledWith("notaio");
  });

  it("refuses a query too short to send", () => {
    const onSearch = vi.fn();
    render(<SearchBox query="" onSearch={onSearch} />);

    fireEvent.change(input(), { target: { value: "a" } });
    fireEvent.submit(input().closest("form") as HTMLFormElement);

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
  });

  it("refuses a query whose words are all too short, however many there are", () => {
    // "a b" is three characters typed but `s=a` on the wire — the whole-instance
    // walk the floor exists to prevent.
    const onSearch = vi.fn();
    render(<SearchBox query="" onSearch={onSearch} />);

    fireEvent.change(input(), { target: { value: "a b" } });
    fireEvent.submit(input().closest("form") as HTMLFormElement);

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("accepts a query where only one word is long enough", () => {
    const onSearch = vi.fn();
    render(<SearchBox query="" onSearch={onSearch} />);

    fireEvent.change(input(), { target: { value: "ab c" } });
    fireEvent.submit(input().closest("form") as HTMLFormElement);

    expect(onSearch).toHaveBeenCalledWith("ab c");
  });

  it("says nothing about length while the box is empty", () => {
    render(<SearchBox query="" onSearch={vi.fn()} />);
    expect(screen.queryByText(/at least 2 characters/i)).toBeNull();
  });

  it("shows the committed query, so a reloaded search agrees with its results", () => {
    render(<SearchBox query="notaio" onSearch={vi.fn()} />);
    expect(input().value).toBe("notaio");
  });

  it("follows the query when it changes underneath, e.g. the back button", () => {
    const { rerender } = render(<SearchBox query="notaio" onSearch={vi.fn()} />);
    rerender(<SearchBox query="fattura" onSearch={vi.fn()} />);
    expect(input().value).toBe("fattura");
  });

  it("clears the search when the clear button is pressed", () => {
    const onSearch = vi.fn();
    render(<SearchBox query="notaio" onSearch={onSearch} />);

    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(input().value).toBe("");
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("offers no clear button when there is nothing to clear", () => {
    render(<SearchBox query="" onSearch={vi.fn()} />);
    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });

  it("empties the box on Escape without leaving the search", () => {
    const onSearch = vi.fn();
    render(<SearchBox query="notaio" onSearch={onSearch} />);

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().value).toBe("");
    // Escape clears the draft; it does not commit an empty search.
    expect(onSearch).not.toHaveBeenCalled();
  });
});
