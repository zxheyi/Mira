import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("package metadata", () => {
  test("defines install readiness metadata", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      engines?: Record<string, string>;
      files?: string[];
    };

    const nodeVersion = (await readFile(join(process.cwd(), ".node-version"), "utf8")).trim();

    expect(packageJson.scripts?.prepare).toContain("tsc");
    expect(packageJson.engines?.node).toBe(">=24.0.0");
    expect(nodeVersion).toBe("24");
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/src", "skills"]));
  });
});
