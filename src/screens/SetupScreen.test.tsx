import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUser } from "../api/endpoints";
import { NetworkError, UnauthorizedError, VikunjaError } from "../api/errors";
import { tokenValue } from "../auth/authStore";
import { baseUrlValue } from "../settings/settingsStore";
import { transportConsentValue } from "../settings/transportPolicy";
import { displayVersion, LoginStep, SetupScreen } from "./SetupScreen";

// LoginStep probes /info on mount to show the version banner. Stubbed so the
// tests below are about the form, not about the network.
vi.mock("../api/endpoints", () => ({
  // Never settles: the banner omits the version, which LoginStep handles, and
  // no state lands after the test body has finished.
  getInfo: vi.fn(() => new Promise(() => {})),
  getUser: vi.fn(async () => ({ id: 1 })),
  login: vi.fn(async () => ({ token: "t" })),
}));

function loginForm() {
  const form = screen.getByRole("button", { name: "Log in" }).closest("form");
  if (!form) throw new Error("login form not found");
  return form;
}

function renderTokenLogin() {
  render(<LoginStep baseUrl="https://vikunja.example" initialVersion="v2.5.0" />);
  fireEvent.click(screen.getByRole("button", { name: "API token" }));
  fireEvent.change(screen.getByLabelText("API token"), {
    target: { value: "tk_candidate" },
  });
}

async function submitToken() {
  fireEvent.submit(loginForm());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Log in" })).not.toBeDisabled(),
  );
}

describe("displayVersion", () => {
  it("does not double the v Vikunja already sends", () => {
    // Regression: ISSUE-001 — the login banner read "vv2.5.0".
    // Found by /qa on 2026-09-10 against a live Vikunja 2.5.0.
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
    vi.mocked(getUser).mockResolvedValue({ id: 1 } as never);
  });
  afterEach(() => {
    tokenValue.clear();
    transportConsentValue.clear();
    baseUrlValue.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps Log in disabled until a credential is typed", () => {
    // Regression: ISSUE-002 — the button was enabled on an empty form, so a
    // stray click cost a round-trip and came back with Vikunja's own
    // "missing, malformed, expired or otherwise invalid token provided" for a
    // field the user had simply not filled in. The sibling server step had
    // guarded this correctly all along.
    // Found by /qa on 2026-09-10 against a live Vikunja 2.5.0.
    render(<SetupScreen />);
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("needs both halves of a username login", () => {
    render(<SetupScreen />);
    const button = screen.getByRole("button", { name: "Log in" });
    // By label, not by role: an authenticator-code textbox appears alongside
    // the username once TOTP is asked for, and getByRole would then be
    // ambiguous about which field it grabbed.
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    expect(button).not.toBeDisabled();
  });

  it("treats a whitespace-only username as empty", () => {
    render(<SetupScreen />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("enables Log in once the API token field is filled", () => {
    render(<SetupScreen />);
    fireEvent.click(screen.getByRole("button", { name: "API token" }));
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "tk_abc" } });
    expect(screen.getByRole("button", { name: "Log in" })).not.toBeDisabled();
  });

  it("does not accept whitespace as a token", () => {
    render(<SetupScreen />);
    fireEvent.click(screen.getByRole("button", { name: "API token" }));
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("stores a token after a successful verification", async () => {
    renderTokenLogin();
    await submitToken();
    expect(tokenValue.get()).toBe("tk_candidate");
  });

  it("retains the form after a 401 rejection", async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new UnauthorizedError("bad token"));
    renderTokenLogin();
    await submitToken();
    expect(screen.getByText("bad token")).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toHaveValue("tk_candidate");
    expect(tokenValue.get()).toBeNull();
  });

  it("accepts the explicit 403 limited-token exception", async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new VikunjaError("scope", 403));
    renderTokenLogin();
    await submitToken();
    expect(tokenValue.get()).toBe("tk_candidate");
  });

  it.each([
    ["a network failure", new NetworkError("offline")],
    ["a server failure", new VikunjaError("unavailable", 503)],
    ["an invalid response", new SyntaxError("unexpected token")],
  ])("retains the form after %s", async (_label, failure) => {
    vi.mocked(getUser).mockRejectedValueOnce(failure);
    renderTokenLogin();
    await submitToken();
    expect(screen.getByLabelText("API token")).toHaveValue("tk_candidate");
    expect(tokenValue.get()).toBeNull();
  });
});
