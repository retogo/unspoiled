import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film directed by M. Night Shyamalan.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home one winter night.</p>
  <p>Malcolm meets Cole Sear, a boy who is frightened of what he keeps seeing.</p>
  <p>Cole tells his mother what he has seen, and she comes to believe him.</p>
  <p>Malcolm understands that he has been a ghost since the opening scene.</p>
</div>`;

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: async () => ({
    lang: "en",
    title: "The Sixth Sense",
    displayTitle: "The Sixth Sense",
    sourceUrl: "https://en.wikipedia.org/wiki/The_Sixth_Sense",
    html: HTML,
  }),
  searchArticles: async () => [],
}));

/** The plot runs in order, so these four are scored 60, 73, 87 and 100. */
const OPENING = /Malcolm Crowe is shot/;
const SECOND = /Malcolm meets Cole Sear/;
const ENDING = /he has been a ghost/;

async function openArticle(search = "?title=The%20Sixth%20Sense&lang=en") {
  window.history.replaceState(null, "", search);
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });
}

function slider(): HTMLInputElement {
  return screen.getByRole("slider") as HTMLInputElement;
}

function drag(to: number) {
  fireEvent.change(slider(), { target: { value: String(to) } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("the sensitivity slider", () => {
  it("opens the plot from its first sentence as the reader lowers it", async () => {
    await openArticle();
    expect(screen.queryByText(OPENING)).toBeNull();

    drag(30);

    expect(screen.getByText(OPENING)).toBeTruthy();
    expect(screen.queryByText(ENDING)).toBeNull();
  });

  it("opens more of the plot the further it is lowered", async () => {
    await openArticle();

    drag(15);
    expect(screen.getByText(SECOND)).toBeTruthy();
    expect(screen.queryByText(ENDING)).toBeNull();

    drag(0);
    expect(screen.getByText(ENDING)).toBeTruthy();
  });

  it("closes the plot again when it is raised", async () => {
    await openArticle();

    drag(0);
    expect(screen.getByText(ENDING)).toBeTruthy();

    drag(100);
    expect(screen.queryByText(ENDING)).toBeNull();
    expect(screen.queryByText(OPENING)).toBeNull();
  });

  it("never leaves a withheld sentence in the page for a reader to find", async () => {
    await openArticle();

    drag(30);

    expect(document.body.textContent).not.toContain("been a ghost since the opening scene");
  });

  it("shows where it stands and how much it is holding back", async () => {
    await openArticle();
    expect(screen.getByText("Sensitivity 75")).toBeTruthy();
    expect(screen.getByText("4 of 6 sentences withheld")).toBeTruthy();

    drag(30);

    expect(screen.getByText("Sensitivity 30")).toBeTruthy();
    expect(screen.getByText("3 of 6 sentences withheld")).toBeTruthy();
  });

  it("counts what each section is holding back, next to its heading", async () => {
    await openArticle();
    expect(screen.getByText("4 withheld")).toBeTruthy();

    drag(30);

    expect(screen.getByText("3 withheld")).toBeTruthy();
  });

  it("remembers where the reader left it", async () => {
    await openArticle();

    drag(20);

    expect(window.localStorage.getItem("unspoiled.sensitivity")).toBe("20");
    expect(window.location.search).toContain("sensitivity=20");
  });
});

describe("the presets marked on the slider", () => {
  it("jumps to the value each one stands for", async () => {
    await openArticle();

    await userEvent.click(screen.getByRole("button", { name: /Balanced/ }));
    expect(slider().value).toBe("50");

    await userEvent.click(screen.getByRole("button", { name: /Open/ }));
    expect(slider().value).toBe("0");

    await userEvent.click(screen.getByRole("button", { name: /Strict/ }));
    expect(slider().value).toBe("75");
  });

  it("shows the whole article at Open", async () => {
    await openArticle();

    await userEvent.click(screen.getByRole("button", { name: /Open/ }));

    expect(screen.getByText(ENDING)).toBeTruthy();
    expect(window.localStorage.getItem("unspoiled.sensitivity")).toBe("0");
  });
});

describe("a shared link", () => {
  it("sets the slider for a reader who has none stored", async () => {
    await openArticle("?title=The%20Sixth%20Sense&lang=en&sensitivity=0");

    expect(slider().value).toBe("0");
    expect(screen.getByText(ENDING)).toBeTruthy();
  });

  it("does not turn its sensitivity into the reader's stored setting", async () => {
    await openArticle("?title=The%20Sixth%20Sense&lang=en&sensitivity=0");

    expect(window.localStorage.getItem("unspoiled.sensitivity")).toBeNull();
  });

  it("does not override what the reader has stored", async () => {
    window.localStorage.setItem("unspoiled.sensitivity", "100");

    await openArticle("?title=The%20Sixth%20Sense&lang=en&sensitivity=0");

    expect(slider().value).toBe("100");
    expect(screen.queryByText(OPENING)).toBeNull();
  });
});
