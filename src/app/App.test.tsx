import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the version injected from VERSION", () => {
    render(<App />);
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });
});
