import { describe, expect, it } from "vitest";
import { maskRows } from "./mask";

describe("how tall a withheld paragraph stands", () => {
  it("gives the shortest paragraphs a single row", () => {
    expect(maskRows(0, "en")).toBe(1);
    expect(maskRows(251, "en")).toBe(1);
    expect(maskRows(361, "en")).toBe(1);
    expect(maskRows(374, "en")).toBe(1);
  });

  it("grows a row at a time across the lengths a real paragraph runs to", () => {
    expect(maskRows(375, "en")).toBe(2);
    expect(maskRows(500, "en")).toBe(2);
    expect(maskRows(750, "en")).toBe(3);
    expect(maskRows(1000, "en")).toBe(4);
    expect(maskRows(1249, "en")).toBe(5);
  });

  it("stops growing at five rows, however long the paragraph is", () => {
    expect(maskRows(1375, "en")).toBe(5);
    expect(maskRows(4000, "en")).toBe(5);
  });

  it("counts Japanese at half the characters a row stands for", () => {
    expect(maskRows(125, "ja")).toBe(1);
    expect(maskRows(188, "ja")).toBe(2);
    expect(maskRows(625, "ja")).toBe(5);
  });
});
