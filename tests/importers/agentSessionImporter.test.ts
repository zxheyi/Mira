import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  importAgentSessionFromFile,
  normalizeMarkdownSession
} from "../../src/importers/agentSessionImporter.js";

describe("agent session importer", () => {
  test("normalizes a Codex Markdown session with an explicit id and inferred H1 title", () => {
    const session = normalizeMarkdownSession({
      id: "codex_session_1",
      source: "codex",
      inputPath: "/workspace/mira/codex-session.md",
      rawText: "# Codex Import Plan\n\n## Key Decisions\n- Support Markdown first."
    });

    expect(session).toEqual({
      id: "codex_session_1",
      source: "codex",
      title: "Codex Import Plan",
      rawFormat: "markdown",
      rawText: "# Codex Import Plan\n\n## Key Decisions\n- Support Markdown first.",
      metadata: { inputPath: "/workspace/mira/codex-session.md" }
    });
  });

  test("generates a stable id and falls back to the file name when Markdown has no H1", () => {
    const input = {
      source: "claude-code" as const,
      inputPath: "/workspace/mira/claude-session.md",
      rawText: "## Summary\nClaude Code imported a session."
    };

    const first = normalizeMarkdownSession(input);
    const second = normalizeMarkdownSession(input);

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^claude-code_/);
    expect(first.title).toBe("claude-session");
  });

  test("rejects unsupported sources", () => {
    expect(() =>
      normalizeMarkdownSession({
        source: "workbuddy",
        inputPath: "/workspace/workbuddy.md",
        rawText: "# WorkBuddy"
      })
    ).toThrow("Unsupported agent session source");
  });

  test("imports a Markdown session from a file", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-importer-"));
    const inputPath = join(tempRoot, "codex-summary.md");
    await writeFile(inputPath, "# Codex Summary\n\nA useful session.", "utf8");

    const session = await importAgentSessionFromFile({ source: "codex", inputPath });

    expect(session).toMatchObject({
      source: "codex",
      title: "Codex Summary",
      rawFormat: "markdown",
      rawText: "# Codex Summary\n\nA useful session.",
      metadata: { inputPath }
    });
    expect(session.id).toContain(basename(inputPath, ".md").split("-")[0]);
  });
});
