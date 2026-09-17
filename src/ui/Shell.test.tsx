import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverlayLayer } from "./overlayStack";
import { Shell } from "./Shell";
import { Sidebar } from "./Sidebar";

const originalWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = vi.fn((query: string) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    return {
      matches: width <= 1050,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.delete(listener);
      },
      dispatchEvent: (event: Event) => {
        for (const listener of listeners) listener(event as MediaQueryListEvent);
        return true;
      },
    } as MediaQueryList;
  });
}

function renderShell(onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(
      <Shell
        sidebar={
          <Sidebar userName="Alex" selected="inbox" projects={[]} onSelect={onSelect} />
        }
      >
        <div data-testid="content">Content</div>
      </Shell>,
    ),
  };
}

function RegisteredDialog() {
  useOverlayLayer("dialog", () => undefined);
  return <div role="dialog" data-testid="dialog" />;
}

function RegisteredPicker() {
  const [open, setOpen] = useState(false);
  useOverlayLayer("picker", () => setOpen(false), open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
      {open ? <button type="button">Picker choice</button> : null}
    </>
  );
}

beforeEach(() => setViewport(390));
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
  window.matchMedia = originalMatchMedia;
});

describe("responsive shell", () => {
  it("Orig-8 hides the closed narrow sidebar from focus and assistive technology", () => {
    renderShell();
    const sidebar = screen.getByRole("navigation", { name: "Views and projects" });

    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveAttribute("inert");
  });

  it("starts narrow with the navigation closed and restores focus after closing", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("closes the overlay with Escape", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("does not dismiss the sidebar for Escape inside a topmost dialog", () => {
    render(
      <Shell
        sidebar={
          <Sidebar userName="Alex" selected="inbox" projects={[]} onSelect={vi.fn()} />
        }
      >
        <RegisteredDialog />
      </Shell>,
    );
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByTestId("dialog"), { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("closes a picker before the sidebar, then closes the sidebar", () => {
    render(
      <Shell
        sidebar={
          <Sidebar userName="Alex" selected="inbox" projects={[]} onSelect={vi.fn()} />
        }
      >
        <RegisteredPicker />
      </Shell>,
    );
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    expect(screen.getByRole("button", { name: "Picker choice" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Picker choice" }), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("button", { name: "Picker choice" }),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("closes after navigation", () => {
    const { onSelect } = renderShell();
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onSelect).toHaveBeenCalledWith("today");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the navigation visible at a wide width", () => {
    cleanup();
    setViewport(1200);
    renderShell();
    expect(screen.getByRole("button", { name: "Toggle navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
