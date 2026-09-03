import { describe, expect, it } from "vitest";
import { maskRows } from "./mask";

describe("how tall a withheld paragraph stands", () => {
  it("stands one row tall for a paragraph that would fill one line", () => {
    expect(maskRows(0, "en")).toBe(1);
    expect(maskRows(90, "en")).toBe(1);
  });

  it("takes another row as soon as the text would wrap", () => {
    expect(maskRows(91, "en")).toBe(2);
    expect(maskRows(180, "en")).toBe(2);
  });

  it("stops growing at three rows, however long the paragraph is", () => {
    expect(maskRows(270, "en")).toBe(3);
    expect(maskRows(271, "en")).toBe(3);
    expect(maskRows(4000, "en")).toBe(3);
  });

  it("counts Japanese at half the characters a line holds", () => {
    expect(maskRows(45, "ja")).toBe(1);
    expect(maskRows(46, "ja")).toBe(2);
    expect(maskRows(135, "ja")).toBe(3);
  });
});
