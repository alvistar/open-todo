import { describe, expect, it } from "vitest";
import { displayVersion } from "./SetupScreen";

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
