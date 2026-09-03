import { beforeEach, vi } from "vitest";

/**
 * jsdom has no `matchMedia`, and the page asks it whether the reader's system is
 * dark. One query object stands in for every call, so a test can set the
 * preference the page reads on mount and fire the change event it listens for.
 */
class ColorSchemeQuery extends EventTarget {
  matches = false;
}

const query = new ColorSchemeQuery();

export function systemPrefersDark(dark: boolean): void {
  query.matches = dark;
}

export function systemSwitchesTo(theme: "light" | "dark"): void {
  query.matches = theme === "dark";
  query.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  query.matches = false;
});

vi.stubGlobal("matchMedia", () => query);
