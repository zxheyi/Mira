import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("CLI exposes the host registry and runs a Cursor turn through the lifecycle port", () => {
  const root = mkdtempSync(join(tmpdir(), "mira-lifecycle-cli-"));
  const run = (...args: string[]) => execFileSync(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--project-root", root, ...args],
    { encoding: "utf8" }
  );

  try {
    const hosts = JSON.parse(run("turn", "hosts")) as Array<{host: string}>;
    expect(hosts.map((item) => item.host)).toEqual([
      "codex", "claude-code", "cursor", "cli", "mcp", "ui"
    ]);

    const before = JSON.parse(run(
      "turn", "before",
      "--host", "cursor",
      "--session", "cursor-session-1",
      "--turn", "cursor-turn-1",
      "--query", "Continue the verified research workflow."
    )) as {session: {host: string}; turn: {id: string; status: string}; context: {receipt: {id: string}}};
    expect(before).toMatchObject({
      session: {host: "cursor"},
      turn: {status: "started"},
      context: {receipt: {id: expect.stringMatching(/^recall_/)}}
    });

    const afterArgs = [
      "turn", "after",
      "--host", "cursor",
      "--session", "cursor-session-1",
      "--turn", "cursor-turn-1",
      "--query", "Continue the verified research workflow.",
      "--response", "Prepared the next evidence review step.",
      "--status", "succeeded"
    ];
    const completed = JSON.parse(run(...afterArgs)) as {
      turn: {id: string; status: string}; duplicate: boolean; outboxMessageIds: string[];
    };
    expect(completed).toMatchObject({
      turn: {id: before.turn.id, status: "completed"},
      duplicate: false
    });
    expect(completed.outboxMessageIds).toHaveLength(2);

    const duplicate = JSON.parse(run(...afterArgs)) as {turn: {id: string}; duplicate: boolean};
    expect(duplicate).toMatchObject({turn: {id: before.turn.id}, duplicate: true});

    const drained = JSON.parse(run("outbox", "run", "--drain")) as {completed: number; failed: number};
    expect(drained).toMatchObject({completed: 2, failed: 0});
    const messages = JSON.parse(run("outbox", "list")) as Array<{status: string}>;
    expect(messages).toHaveLength(2);
    expect(messages.every((item) => item.status === "completed")).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
