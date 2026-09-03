import { describe, expect, it } from "vitest";
import { nextHighlight, requestOrder, suggestable } from "./suggest";

describe("deciding a term is worth searching for", () => {
  it("waits for a second character", () => {
    expect(suggestable("")).toBe(false);
    expect(suggestable("s")).toBe(false);
    expect(suggestable("si")).toBe(true);
  });

  it("does not count the space around the term", () => {
    expect(suggestable("  s  ")).toBe(false);
    expect(suggestable("  si  ")).toBe(true);
  });
});

describe("keeping the newest request", () => {
  it("holds the ticket of the request taken last", () => {
    const order = requestOrder();
    const first = order.take();
    const second = order.take();

    expect(order.isCurrent(first)).toBe(false);
    expect(order.isCurrent(second)).toBe(true);
  });
});

describe("moving the highlight with the arrow keys", () => {
  it("steps down from the reader's own text into the list", () => {
    expect(nextHighlight(-1, 1, 3)).toBe(0);
    expect(nextHighlight(0, 1, 3)).toBe(1);
  });

  it("comes back to the reader's own text at either end", () => {
    expect(nextHighlight(2, 1, 3)).toBe(-1);
    expect(nextHighlight(0, -1, 3)).toBe(-1);
  });

  it("steps up from the reader's own text to the last suggestion", () => {
    expect(nextHighlight(-1, -1, 3)).toBe(2);
  });

  it("has nowhere to move with nothing suggested", () => {
    expect(nextHighlight(-1, 1, 0)).toBe(-1);
  });
});
