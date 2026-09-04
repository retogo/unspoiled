import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { systemPrefersDark, systemSwitchesTo } from "./test-setup";

function painted(): string | undefined {
  return document.documentElement.dataset.theme;
}

function choice(label: string): HTMLElement {
  return screen.getByRole("radio", { name: label });
}

function switchTo(label: string): Promise<void> {
  return userEvent.click(choice(label));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  delete document.documentElement.dataset.theme;
});

afterEach(cleanup);

describe("the page theme", () => {
  it("follows a light system when the reader has chosen nothing", () => {
    render(<App />);
    expect(painted()).toBe("light");
  });

  it("follows a dark system when the reader has chosen nothing", () => {
    systemPrefersDark(true);
    render(<App />);
    expect(painted()).toBe("dark");
  });

  it("restores the choice the reader made on an earlier visit", () => {
    window.localStorage.setItem("unspoiled.theme", "dark");
    render(<App />);
    expect(painted()).toBe("dark");
  });

  it("follows the system when storage holds something the page never wrote", () => {
    window.localStorage.setItem("unspoiled.theme", "midnight");
    systemPrefersDark(true);
    render(<App />);
    expect(painted()).toBe("dark");
  });

  it("paints and remembers the theme the reader picks", async () => {
    render(<App />);

    await switchTo("Dark");

    expect(painted()).toBe("dark");
    expect(window.localStorage.getItem("unspoiled.theme")).toBe("dark");
  });

  it("goes straight to any of the three, in any order", async () => {
    render(<App />);

    for (const [label, stored] of [
      ["Dark", "dark"],
      ["Light", "light"],
      ["System", "system"],
      ["Dark", "dark"],
    ]) {
      await switchTo(label);
      expect(window.localStorage.getItem("unspoiled.theme")).toBe(stored);
    }
  });

  it("keeps a reader who picked light on light under a dark system", async () => {
    systemPrefersDark(true);
    render(<App />);

    await switchTo("Light");

    expect(painted()).toBe("light");
  });

  it("follows the system as it changes while the page is open", () => {
    render(<App />);

    systemSwitchesTo("dark");

    expect(painted()).toBe("dark");
  });

  it("stops following the system once the reader has picked a theme", async () => {
    render(<App />);
    await switchTo("Light");

    systemSwitchesTo("dark");

    expect(painted()).toBe("light");
  });

  it("follows the system again when the reader hands it back", async () => {
    render(<App />);
    await switchTo("Light");

    await switchTo("System");
    systemSwitchesTo("dark");

    expect(painted()).toBe("dark");
  });

  /* Icons alone, so the name of each one is the only thing that says which is which. */
  it("says which of the three is in use for a reader who cannot see them", async () => {
    render(<App />);
    expect(screen.getByRole("radiogroup", { name: "Page theme" })).toBeTruthy();
    expect(choice("System").getAttribute("aria-checked")).toBe("true");

    await switchTo("Dark");

    expect(choice("Dark").getAttribute("aria-checked")).toBe("true");
    expect(choice("System").getAttribute("aria-checked")).toBe("false");
    expect(choice("Light").getAttribute("aria-checked")).toBe("false");
  });

  it("offers all three at once", () => {
    render(<App />);

    expect(screen.getAllByRole("radio").map((option) => option.getAttribute("aria-label"))).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
  });

  /* Arrow keys move through a radio group, and moving through this one picks as it goes. */
  it("moves through the three with the arrow keys", async () => {
    render(<App />);
    choice("System").focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(painted()).toBe("light");

    await userEvent.keyboard("{ArrowRight}");
    expect(painted()).toBe("dark");

    await userEvent.keyboard("{ArrowLeft}");
    expect(painted()).toBe("light");
  });

  it("carries the focus to the one the arrow keys moved to", async () => {
    render(<App />);
    await switchTo("Light");

    await userEvent.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(choice("Dark"));
    expect(choice("Dark").getAttribute("aria-checked")).toBe("true");
  });
});
