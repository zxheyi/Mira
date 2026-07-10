import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("mira CLI", () => {
  test("health prints mira:ok", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "dev", "--", "health"], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" }
    });

    expect(stdout.trim().split(/\r?\n/).at(-1)).toBe("mira:ok");
  });
});
