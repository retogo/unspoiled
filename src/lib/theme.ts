export const THEME_KEY = "unspoiled.theme";

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** What the reader picked. `system` defers to the operating system, and is the default. */
export type ThemeChoice = "light" | "dark" | "system";

/** What the page paints, once the system has had its say. */
export type Theme = "light" | "dark";

const CHOICES: ThemeChoice[] = ["light", "dark", "system"];

/**
 * Storage is untrusted input: another tab, an older build or the reader's own
 * devtools may have left anything under the key, and anything that is not one of
 * the three choices means the reader has not chosen.
 */
export function readTheme(raw: string | null): ThemeChoice {
  return CHOICES.find((choice) => choice === raw) ?? "system";
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/** `color-scheme` follows `data-theme` in the stylesheet, so this is the only handle JavaScript needs. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
