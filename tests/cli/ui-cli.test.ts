import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("mira ui CLI", () => {
  test("exposes the local viewer command", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "dev", "--", "ui", "--help"], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" }
    });

    expect(stdout).toContain("Start the local Mira memory management viewer");
    expect(stdout).toContain("--host <host>");
    expect(stdout).toContain("--port <port>");
  });
});
