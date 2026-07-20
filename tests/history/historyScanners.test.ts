import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { scanClaudeHistory } from "../../src/history/claudeHistoryScanner.js";
import { scanCodexHistory } from "../../src/history/codexHistoryScanner.js";

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

describe("history scanners", () => {
  test("scans Codex sessions and archived sessions in stable path order", async () => {
    const home = await mkdtemp(join(tmpdir(), "mira-codex-history-"));
    const current = join(home, "sessions", "2026", "07", "current.jsonl");
    const archived = join(home, "archived_sessions", "archived.jsonl");
    await mkdir(join(home, "sessions", "2026", "07"), { recursive: true });
    await mkdir(join(home, "archived_sessions"), { recursive: true });
    await writeFile(current, jsonl([
      { type: "session_meta", payload: { id: "codex-current", cwd: "/workspace/Mira" } },
      { type: "response_item", payload: { role: "user", content: "current body" } }
    ]));
    await writeFile(archived, jsonl([
      { type: "session_meta", payload: { session_id: "codex-archived", cwd: "/workspace/AnchorMem" } }
    ]));

    const candidates = await scanCodexHistory({ codexHome: home });

    expect(candidates.map((item) => item.filePath)).toEqual([archived, current].sort());
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "codex", sessionId: "codex-current", cwd: "/workspace/Mira" }),
      expect.objectContaining({ agent: "codex", sessionId: "codex-archived", cwd: "/workspace/AnchorMem" })
    ]));
  });

  test("returns missing metadata as a classifiable Codex candidate and tolerates a missing home", async () => {
    const home = await mkdtemp(join(tmpdir(), "mira-codex-bad-history-"));
    const path = join(home, "sessions", "bad.jsonl");
    await mkdir(join(home, "sessions"), { recursive: true });
    await writeFile(path, "{not json}\n");

    expect(await scanCodexHistory({ codexHome: join(home, "missing") })).toEqual([]);
    expect(await scanCodexHistory({ codexHome: home })).toEqual([
      expect.objectContaining({ filePath: path, metadataError: expect.stringContaining("metadata") })
    ]);
  });

  test("scans only Claude main session JSONL files and excludes escaping symlinks", async () => {
    const home = await mkdtemp(join(tmpdir(), "mira-claude-history-"));
    const projectDir = join(home, "projects", "-workspace-Mira");
    const main = join(projectDir, "main.jsonl");
    const subagent = join(projectDir, "subagents", "agent-1.jsonl");
    const outside = join(await mkdtemp(join(tmpdir(), "mira-claude-outside-")), "outside.jsonl");
    await mkdir(join(projectDir, "subagents"), { recursive: true });
    await writeFile(main, jsonl([
      { type: "user", sessionId: "claude-main", cwd: "/workspace/Mira", message: { content: "main body" } }
    ]));
    await writeFile(subagent, jsonl([
      { sessionId: "claude-subagent", cwd: "/workspace/Mira", message: { content: "subagent body" } }
    ]));
    await writeFile(join(projectDir, "notes.md"), "not a transcript");
    await writeFile(outside, jsonl([{ sessionId: "outside", cwd: "/workspace/Mira" }]));
    await symlink(outside, join(projectDir, "outside.jsonl"));

    const candidates = await scanClaudeHistory({ claudeConfigDir: home });

    expect(candidates).toEqual([
      expect.objectContaining({
        agent: "claude-code", filePath: main, sessionId: "claude-main", cwd: "/workspace/Mira"
      })
    ]);
  });

  test("keeps malformed Claude metadata classifiable and tolerates missing projects", async () => {
    const home = await mkdtemp(join(tmpdir(), "mira-claude-bad-history-"));
    const projectDir = join(home, "projects", "-workspace-Mira");
    const bad = join(projectDir, "bad.jsonl");
    await mkdir(projectDir, { recursive: true });
    await writeFile(bad, jsonl([{ type: "user", cwd: "/workspace/Mira" }]));

    expect(await scanClaudeHistory({ claudeConfigDir: join(home, "missing") })).toEqual([]);
    expect(await scanClaudeHistory({ claudeConfigDir: home })).toEqual([
      expect.objectContaining({ filePath: bad, metadataError: expect.stringContaining("session") })
    ]);
  });
});
