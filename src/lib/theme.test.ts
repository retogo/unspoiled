import { describe, expect, it } from "vitest";
import { readTheme, resolveTheme } from "./theme";

describe("readTheme", () => {
  it("keeps a choice the reader made", () => {
    expect(readTheme("light")).toBe("light");
    expect(readTheme("dark")).toBe("dark");
    expect(readTheme("system")).toBe("system");
  });

  it.each([null, "", "Dark", "auto", "light dark", " dark"])(
    "follows the system for %o, which is not a choice the page offers",
    (raw) => {
      expect(readTheme(raw)).toBe("system");
    },
  );
});

describe("resolveTheme", () => {
  it("takes the reader's choice over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when the reader has not chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
