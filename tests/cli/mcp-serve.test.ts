import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("mira mcp serve CLI", () => {
  test("exposes the stdio serve command", async () => {
    const { stdout } = await execFileAsync("npm", ["run", "dev", "--", "mcp", "serve", "--help"], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" }
    });

    expect(stdout).toContain("Start the Mira MCP stdio server");
    expect(stdout).toContain("--db <path>");
    expect(stdout).toContain("--project-root <path>");
    expect(stdout).toContain("--confirmation-policy <reason>");
  });
});
