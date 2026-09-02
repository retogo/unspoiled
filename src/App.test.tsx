import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { searchArticles } from "./lib/wikipedia";

vi.mock("./lib/wikipedia", () => ({
  searchArticles: vi.fn(() => Promise.resolve([])),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function searchBox() {
  return screen.getByPlaceholderText("Search Wikipedia for a film, series or novel");
}

describe("the search box", () => {
  it("does not search on the Enter that confirms an IME conversion", () => {
    render(<App />);
    const input = searchBox();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "しっくすせんす" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(searchArticles).not.toHaveBeenCalled();
  });

  it("searches on Enter once the text is committed", () => {
    render(<App />);
    const input = searchBox();

    fireEvent.change(input, { target: { value: "シックス・センス" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(searchArticles).toHaveBeenCalledWith("en", "シックス・センス");
  });
});
