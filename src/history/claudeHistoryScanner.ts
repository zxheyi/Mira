import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { HistorySessionCandidate } from "./historyTypes.js";
import {
  collectJsonlFiles,
  existingRealPath,
  fileMetadata,
  isPathWithin,
  readJsonlMetadata
} from "./scannerUtils.js";

export type ScanClaudeHistoryOptions = {
  claudeConfigDir?: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function scanClaudeHistory(options: ScanClaudeHistoryOptions = {}): Promise<HistorySessionCandidate[]> {
  const home = resolve(options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
  const boundary = await existingRealPath(home);
  const projects = join(home, "projects");
  const projectsReal = await existingRealPath(projects);
  if (!boundary || !projectsReal || !isPathWithin(boundary, projectsReal)) return [];

  const files: string[] = [];
  for (const entry of await readdir(projects, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files.push(...await collectJsonlFiles(join(projects, entry.name), boundary, false));
  }
  files.sort((left, right) => left.localeCompare(right));

  const candidates: HistorySessionCandidate[] = [];
  for (const filePath of files) {
    try {
      const metadata = await readJsonlMetadata(filePath, (record) => ({
        sessionId: stringValue(record.sessionId),
        cwd: stringValue(record.cwd)
      }));
      candidates.push({
        agent: "claude-code",
        filePath,
        sessionId: metadata.sessionId,
        cwd: metadata.cwd,
        ...await fileMetadata(filePath),
        ...(!metadata.sessionId || !metadata.cwd
          ? { metadataError: "Claude session metadata is missing sessionId or cwd" }
          : {})
      });
    } catch (error) {
      candidates.push({
        agent: "claude-code",
        filePath,
        size: 0,
        mtimeMs: 0,
        discoveryError: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return candidates;
}
