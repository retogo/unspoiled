import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { systemPrefersDark, systemSwitchesTo } from "./test-setup";

function painted(): string | undefined {
  return document.documentElement.dataset.theme;
}

/** The one theme control, named for where it is and where the next press will take it. */
function toggle(): HTMLElement {
  return screen.getByRole("button", { name: /^Theme: / });
}

function switchTo(label: string): Promise<void> {
  return userEvent.click(screen.getByRole("button", { name: new RegExp(`Switch to ${label}$`) }));
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

  it("paints and remembers the theme the reader turns it to", async () => {
    render(<App />);

    await switchTo("Light");
    await switchTo("Dark");

    expect(painted()).toBe("dark");
    expect(window.localStorage.getItem("unspoiled.theme")).toBe("dark");
  });

  it("turns light, then dark, then back to the system", async () => {
    render(<App />);

    await switchTo("Light");
    expect(window.localStorage.getItem("unspoiled.theme")).toBe("light");

    await switchTo("Dark");
    expect(window.localStorage.getItem("unspoiled.theme")).toBe("dark");

    await switchTo("System");
    expect(window.localStorage.getItem("unspoiled.theme")).toBe("system");
  });

  it("keeps a reader who turned it to light on light under a dark system", async () => {
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

  it("stops following the system once the reader has turned it somewhere", async () => {
    render(<App />);
    await switchTo("Light");

    systemSwitchesTo("dark");

    expect(painted()).toBe("light");
  });

  it("follows the system again when the reader hands it back", async () => {
    render(<App />);
    await switchTo("Light");
    await switchTo("Dark");

    await switchTo("System");
    systemSwitchesTo("dark");

    expect(painted()).toBe("dark");
  });

  /* The icon says where the theme is; the name has to say that and where the next press goes. */
  it("says where it is and where the next press takes it", async () => {
    render(<App />);
    expect(toggle().getAttribute("aria-label")).toBe("Theme: System. Switch to Light");
    expect(toggle().getAttribute("title")).toBe("Theme: System. Switch to Light");

    await switchTo("Light");

    expect(toggle().getAttribute("aria-label")).toBe("Theme: Light. Switch to Dark");
  });

  it("is one control rather than three", () => {
    render(<App />);

    expect(screen.getAllByRole("button", { name: /^Theme: / })).toHaveLength(1);
  });
});
