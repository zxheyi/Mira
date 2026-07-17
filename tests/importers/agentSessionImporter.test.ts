import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  importAgentSessionFromFile,
  normalizeJsonlSession,
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

  test("keeps readable slugs for non-ASCII file names", () => {
    const session = normalizeMarkdownSession({
      source: "codex",
      inputPath: "/workspace/mira/中文会话.md",
      rawText: "## Summary\n中文内容"
    });

    expect(session.id).toMatch(/^codex_中文会话_/);
  });


  test("infers JSONL titles through the shared file title helper", () => {
    const session = normalizeJsonlSession({
      source: "codex",
      inputPath: "/workspace/mira/codex.shared-title.jsonl",
      rawText: JSON.stringify({ role: "user", content: "Hello" })
    });

    expect(session.title).toBe("codex.shared-title");
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

  test("normalizes a Claude Code JSONL transcript into Markdown thread text", () => {
    const rawText = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-10T10:00:00.000Z",
        message: { role: "user", content: "Please add JSONL import." }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-07-10T10:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll add a transcript importer." },
            { type: "tool_use", name: "Edit", input: { file_path: "src/importers/agentSessionImporter.ts" } }
          ]
        }
      })
    ].join("\n");

    const session = normalizeJsonlSession({
      source: "claude-code",
      inputPath: "/workspace/mira/claude-transcript.jsonl",
      rawText
    });

    expect(session).toMatchObject({
      source: "claude-code",
      title: "claude-transcript",
      rawFormat: "jsonl",
      metadata: { inputPath: "/workspace/mira/claude-transcript.jsonl" }
    });
    expect(session.rawText).toContain("# claude-transcript");
    expect(session.rawText).toContain("## user");
    expect(session.rawText).toContain("Time: 2026-07-10T10:00:00.000Z");
    expect(session.rawText).toContain("Please add JSONL import.");
    expect(session.rawText).toContain("I'll add a transcript importer.");
    expect(session.rawText).toContain("Tool: Edit");
  });

  test("normalizes a Codex JSONL transcript with direct role/content messages", () => {
    const rawText = [
      JSON.stringify({ role: "user", content: "Use SDD and TDD." }),
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "I will write tests first." },
          { type: "tool_call", name: "shell", input: { cmd: "npm test" } }
        ]
      })
    ].join("\n");

    const session = normalizeJsonlSession({
      source: "codex",
      inputPath: "/workspace/mira/codex-transcript.jsonl",
      title: "Codex Transcript",
      rawText
    });

    expect(session).toMatchObject({
      source: "codex",
      title: "Codex Transcript",
      rawFormat: "jsonl"
    });
    expect(session.rawText).toContain("# Codex Transcript");
    expect(session.rawText).toContain("Use SDD and TDD.");
    expect(session.rawText).toContain("I will write tests first.");
    expect(session.rawText).toContain("Tool: shell");
  });

  test("normalizes current Codex response_item and event_msg envelopes", () => {
    const rawText = [
      JSON.stringify({
        timestamp: "2026-07-17T10:00:00.000Z",
        type: "session_meta",
        payload: { session_id: "session-1", cwd: "/workspace/mira" }
      }),
      JSON.stringify({
        timestamp: "2026-07-17T10:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Capture the Codex transcript." }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-17T10:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: { cmd: "npm test" }
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-17T10:03:00.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Codex transcript captured."
        }
      })
    ].join("\n");

    const session = normalizeJsonlSession({
      source: "codex",
      inputPath: "/workspace/mira/rollout-session-1.jsonl",
      rawText
    });

    expect(session.rawText).toContain("## user");
    expect(session.rawText).toContain("Capture the Codex transcript.");
    expect(session.rawText).toContain("Tool: shell");
    expect(session.rawText).toContain("## assistant");
    expect(session.rawText).toContain("Codex transcript captured.");
    expect(session.rawText).not.toContain("session_meta");
  });

  test("reports invalid JSONL line numbers", () => {
    expect(() =>
      normalizeJsonlSession({
        source: "codex",
        inputPath: "/workspace/mira/bad.jsonl",
        rawText: `${JSON.stringify({ role: "user", content: "ok" })}\nnot-json`
      })
    ).toThrow("Invalid JSONL on line 2");
  });
});
