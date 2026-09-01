import { describe, expect, test } from "vitest";
import { createProjectMatcher, normalizeProjectPath } from "../../src/history/projectMatcher.js";

describe("history project matcher", () => {
  test("matches the current root and explicit historical aliases only", () => {
    const matcher = createProjectMatcher("/Users/me/Desktop/Mira", [
      "/Users/me/Desktop/Mira-legacy",
      "/Users/me/Desktop/Mira-legacy/"
    ]);

    expect(matcher("/Users/me/Desktop/Mira")).toBe(true);
    expect(matcher("/Users/me/Desktop/Mira-legacy")).toBe(true);
    expect(createProjectMatcher("/Users/me/Desktop/Mira", [])("/Users/me/Desktop/Mira-legacy")).toBe(false);
    expect(matcher("/Users/me/Desktop/Mira-copy")).toBe(false);
    expect(matcher(undefined)).toBe(false);
  });

  test("normalizes absolute path syntax without requiring aliases to exist", () => {
    expect(normalizeProjectPath("/workspace/missing/../Mira-legacy/")).toBe("/workspace/Mira-legacy");
  });
});
