import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { HistorySessionCandidate } from "./historyTypes.js";
import { collectJsonlFiles, existingRealPath, fileMetadata, readJsonlMetadata } from "./scannerUtils.js";

export type ScanCodexHistoryOptions = {
  codexHome?: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function scanCodexHistory(options: ScanCodexHistoryOptions = {}): Promise<HistorySessionCandidate[]> {
  const home = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const boundary = await existingRealPath(home);
  if (!boundary) return [];

  const files = (
    await Promise.all([
      collectJsonlFiles(join(home, "sessions"), boundary, true),
      collectJsonlFiles(join(home, "archived_sessions"), boundary, true)
    ])
  ).flat().sort((left, right) => left.localeCompare(right));

  const candidates: HistorySessionCandidate[] = [];
  for (const filePath of files) {
    try {
      const metadata = await readJsonlMetadata(filePath, (record) => {
        if (record.type !== "session_meta") return undefined;
        const payload = typeof record.payload === "object" && record.payload !== null
          ? record.payload as Record<string, unknown>
          : {};
        return {
          sessionId: stringValue(payload.id) ?? stringValue(payload.session_id),
          cwd: stringValue(payload.cwd)
        };
      });
      candidates.push({
        agent: "codex",
        filePath,
        sessionId: metadata.sessionId,
        cwd: metadata.cwd,
        ...await fileMetadata(filePath),
        ...(!metadata.sessionId || !metadata.cwd
          ? { metadataError: "Codex session metadata is missing session id or cwd" }
          : {})
      });
    } catch (error) {
      candidates.push({
        agent: "codex",
        filePath,
        size: 0,
        mtimeMs: 0,
        discoveryError: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return candidates;
}
