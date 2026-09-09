import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, isThemePreference, readThemePreference, setTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(readThemePreference()).toBe("auto");
  });

  it("ignores a stored value that is not a preference", () => {
    localStorage.setItem("open-todo.theme", "chartreuse");
    expect(readThemePreference()).toBe("auto");
  });

  it("stamps data-theme for an explicit choice and removes it for auto", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("auto");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("round-trips through storage", () => {
    setTheme("light");
    expect(readThemePreference()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("recognises the three preferences and nothing else", () => {
    expect(isThemePreference("auto")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
