import { describe, expect, it } from "vitest";
import { bottomOverlap, scrollToFollow } from "./scroll";

describe("keeping the words that are arriving in view", () => {
  const VIEWPORT = 800;

  it("leaves the page alone while the words are still well up the screen", () => {
    expect(scrollToFollow(400, VIEWPORT, 0)).toBe(0);
  });

  it("moves the page just far enough to put the word back above the foot", () => {
    expect(scrollToFollow(700, VIEWPORT, 0)).toBe(20);
  });

  it("never pulls the page back up towards a word that has scrolled off the top", () => {
    expect(scrollToFollow(-50, VIEWPORT, 0)).toBe(0);
  });

  it("moves further when something is sitting over the foot of the window", () => {
    expect(scrollToFollow(700, VIEWPORT, 66)).toBe(scrollToFollow(700, VIEWPORT, 0) + 66);
  });

  it("gives the reader the same room to read on whatever the window height", () => {
    expect(scrollToFollow(700, VIEWPORT, 0)).toBe(scrollToFollow(500, VIEWPORT - 200, 0));
  });
});

describe("how much of the foot of the window something covers", () => {
  const VIEWPORT = 800;

  it("counts a bar pinned across the bottom as its own height", () => {
    expect(bottomOverlap({ top: 734, bottom: 800 }, VIEWPORT)).toBe(66);
  });

  it("counts nothing for a panel that ends above the foot", () => {
    expect(bottomOverlap({ top: 24, bottom: 300 }, VIEWPORT)).toBe(0);
  });

  it("counts nothing for a bar that has been scrolled past the foot entirely", () => {
    expect(bottomOverlap({ top: 900, bottom: 966 }, VIEWPORT)).toBe(0);
  });
});
