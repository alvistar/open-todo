export type ThemePreference = "auto" | "light" | "dark";

const STORAGE_KEY = "open-todo.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "auto";
  } catch {
    // Private mode / blocked storage: fall back to following the system.
    return "auto";
  }
}

/**
 * "auto" removes the attribute entirely so the prefers-color-scheme rules in
 * tokens.css take over; an explicit choice stamps data-theme on <html>.
 */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Non-fatal: the theme still applies for this page view.
  }
}

export function setTheme(preference: ThemePreference): void {
  storeThemePreference(preference);
  applyTheme(preference);
}

/** Resolves "auto" against the media query, for UI that must show a concrete theme. */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "auto") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
