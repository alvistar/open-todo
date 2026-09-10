import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseUrlValue } from "../settings/settingsStore";
import { displayVersion, SetupScreen } from "./SetupScreen";

// LoginStep probes /info on mount to show the version banner. Stubbed so the
// tests below are about the form, not about the network.
vi.mock("../api/endpoints", () => ({
  getInfo: vi.fn(async () => ({ version: "v2.5.0" })),
  getUser: vi.fn(async () => ({ id: 1 })),
  login: vi.fn(async () => ({ token: "t" })),
}));

describe("displayVersion", () => {
  it("does not double the v Vikunja already sends", () => {
    // Regression: ISSUE-001 — the login banner read "vv2.5.0".
    // Found by /qa on 2026-09-10 against a live Vikunja 2.5.0.
    // Report: .gstack/qa-reports/qa-report-localhost-2026-09-10.md
    expect(displayVersion("v2.5.0")).toBe("v2.5.0");
    expect(displayVersion("V2.5.0")).toBe("v2.5.0");
  });

  it("adds the v when the server omits it", () => {
    expect(displayVersion("2.5.0")).toBe("v2.5.0");
  });

  it("tolerates surrounding whitespace", () => {
    expect(displayVersion("  v2.5.0  ")).toBe("v2.5.0");
  });
});

describe("LoginStep — the submit guard", () => {
  beforeEach(() => {
    baseUrlValue.set("https://vikunja.example");
  });
  afterEach(() => {
    baseUrlValue.clear();
    localStorage.clear();
  });

  it("keeps Log in disabled until a credential is typed", () => {
    // Regression: ISSUE-002 — the button was enabled on an empty form, so a
    // stray click cost a round-trip and came back with Vikunja's own
    // "missing, malformed, expired or otherwise invalid token provided" for a
    // field the user had simply not filled in. The sibling server step had
    // guarded this correctly all along.
    // Found by /qa on 2026-09-10 against a live Vikunja 2.5.0.
    // Report: .gstack/qa-reports/qa-report-localhost-2026-09-10.md
    render(<SetupScreen />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("needs both halves of a username login", () => {
    render(<SetupScreen />);
    const button = screen.getByRole("button", { name: "Log in" });
    const username = screen.getByRole("textbox");
    const password = document.querySelector('input[type="password"]');
    if (!password) throw new Error("expected the password field");

    fireEvent.change(username, { target: { value: "alice" } });
    expect(button).toBeDisabled();

    fireEvent.change(password, { target: { value: "hunter2" } });
    expect(button).not.toBeDisabled();
  });

  it("treats a whitespace-only username as empty", () => {
    render(<SetupScreen />);
    const password = document.querySelector('input[type="password"]');
    if (!password) throw new Error("expected the password field");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.change(password, { target: { value: "hunter2" } });
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("enables Log in once the API token field is filled", () => {
    render(<SetupScreen />);
    fireEvent.click(screen.getByRole("button", { name: "API token" }));
    const field = document.querySelector('input[type="password"]');
    if (!field) throw new Error("expected the API token field");
    fireEvent.change(field, { target: { value: "tk_abc" } });
    expect(screen.getByRole("button", { name: "Log in" })).not.toBeDisabled();
  });

  it("does not accept whitespace as a token", () => {
    render(<SetupScreen />);
    fireEvent.click(screen.getByRole("button", { name: "API token" }));
    const field = document.querySelector('input[type="password"]');
    if (!field) throw new Error("expected the API token field");
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });
});
