import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import { normalizeJsonlSession } from "../importers/agentSessionImporter.js";
import { enqueueDistillJob } from "../distill/distillJobStore.js";
import { captureSession, type CapturePreview } from "../threads/sessionCapture.js";
import { stableThreadId } from "../integrations/threadIdentity.js";
import type { Project } from "../projects/projectStore.js";
import { getThread } from "../threads/threadStore.js";
import { scanClaudeHistory } from "./claudeHistoryScanner.js";
import { scanCodexHistory } from "./codexHistoryScanner.js";
import {
  createHistoryImportRun,
  failHistoryImportRun,
  findLatestHistoryImportItem,
  finishHistoryImportRun,
  recordHistoryImportItem,
  sanitizeHistoryImportError
} from "./historyImportStore.js";
import { createProjectMatcher, normalizeProjectPath } from "./projectMatcher.js";
import type {
  HistoryAgent,
  HistoryDistillStatus,
  HistoryImportCapacityCandidate,
  HistoryImportCounts,
  HistoryImportErrorStage,
  HistoryImportItem,
  HistoryImportOutcome,
  HistoryImportReport,
  HistoryImportSummary,
  HistorySessionCandidate
} from "./historyTypes.js";

export type HistoryImportFilters = {
  sinceMs?: number;
  untilExclusiveMs?: number;
  maxFileSizeBytes?: number;
  limit?: number;
};

export type ImportProjectHistoryOptions = {
  db: Database.Database;
  project: Project;
  projectRoot: string;
  agents: readonly HistoryAgent[];
  rootAliases?: string[];
  dryRun?: boolean;
  distill?: boolean;
  codexHome?: string;
  claudeConfigDir?: string;
  filters?: HistoryImportFilters;
  scan?: (agents: readonly HistoryAgent[]) => Promise<HistorySessionCandidate[]>;
};

function emptyCounts(): HistoryImportCounts {
  return { scanned: 0, imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
}

function emptySummary(): HistoryImportSummary {
  return {
    matchedCount: 0,
    matchedBytes: 0,
    matchedMegabytes: 0,
    skippedByDateCount: 0,
    skippedBySizeCount: 0,
    limitedCount: 0,
    largestCandidates: []
  };
}

function summarizeCandidate(candidate: HistorySessionCandidate): HistoryImportCapacityCandidate {
  return {
    agent: candidate.agent,
    sessionId: candidate.sessionId,
    cwd: candidate.cwd,
    filePath: candidate.filePath,
    size: candidate.size,
    mtimeMs: candidate.mtimeMs
  };
}

function finalizeSummary(summary: HistoryImportSummary): HistoryImportSummary {
  return {
    ...summary,
    matchedMegabytes: Number((summary.matchedBytes / (1024 * 1024)).toFixed(2)),
    largestCandidates: [...summary.largestCandidates]
      .sort((left, right) => right.size - left.size || left.filePath.localeCompare(right.filePath))
      .slice(0, 10)
  };
}

async function defaultScan(options: ImportProjectHistoryOptions): Promise<HistorySessionCandidate[]> {
  const candidates: HistorySessionCandidate[] = [];
  if (options.agents.includes("codex")) {
    candidates.push(...await scanCodexHistory({ codexHome: options.codexHome }));
  }
  if (options.agents.includes("claude-code")) {
    candidates.push(...await scanClaudeHistory({ claudeConfigDir: options.claudeConfigDir }));
  }
  return candidates;
}

function increment(counts: HistoryImportCounts, outcome: HistoryImportOutcome): void {
  counts[outcome] += 1;
}

export async function importProjectHistory(
  options: ImportProjectHistoryOptions
): Promise<HistoryImportReport> {
  const startedAt = new Date().toISOString();
  const dryRun = options.dryRun ?? false;
  const distill = options.distill ?? false;
  const aliases = (options.rootAliases ?? []).map(normalizeProjectPath);
  const matcher = createProjectMatcher(options.projectRoot, aliases);
  const counts = emptyCounts();
  const summary = emptySummary();
  let acceptedMatchedCount = 0;
  const items: HistoryImportItem[] = [];
  const run = dryRun ? undefined : createHistoryImportRun(options.db, {
    projectId: options.project.id,
    agents: [...options.agents],
    rootAliases: aliases,
    options: { distill }
  });

  let candidates: HistorySessionCandidate[];
  try {
    candidates = await (options.scan ? options.scan(options.agents) : defaultScan(options));
  } catch (error) {
    if (run) failHistoryImportRun(options.db, run.id, error, counts);
    throw error;
  }
  candidates.sort((left, right) => left.filePath.localeCompare(right.filePath));
  counts.scanned = candidates.length;

  const appendItem = (input: Omit<HistoryImportItem, "id" | "runId" | "createdAt">): HistoryImportItem => {
    const item = run
      ? recordHistoryImportItem(options.db, { runId: run.id, ...input })
      : {
        id: `dry_item_${items.length + 1}`,
        ...input,
        createdAt: new Date().toISOString()
      };
    items.push(item);
    increment(counts, item.outcome);
    return item;
  };

  for (const candidate of candidates) {
    const common = {
      agent: candidate.agent,
      sessionId: candidate.sessionId,
      filePath: candidate.filePath,
      cwd: candidate.cwd
    };
    if (candidate.discoveryError) {
      appendItem({
        ...common,
        outcome: "failed",
        distillStatus: "not_requested",
        errorStage: "scan",
        errorReason: sanitizeHistoryImportError(candidate.discoveryError)
      });
      continue;
    }
    if (candidate.metadataError || !candidate.sessionId || !candidate.cwd) {
      appendItem({
        ...common,
        outcome: "skipped",
        distillStatus: "not_applicable",
        errorStage: "metadata",
        errorReason: candidate.metadataError ?? "Session metadata is missing session id or cwd"
      });
      continue;
    }
    if (!matcher(candidate.cwd)) {
      appendItem({
        ...common,
        outcome: "skipped",
        distillStatus: "not_applicable",
        errorStage: "match",
        errorReason: "Session cwd does not match the current project or an explicit root alias"
      });
      continue;
    }

    summary.largestCandidates.push(summarizeCandidate(candidate));
    const filters = options.filters;
    const skippedBySince = filters?.sinceMs !== undefined && candidate.mtimeMs < filters.sinceMs;
    const skippedByUntil = filters?.untilExclusiveMs !== undefined && candidate.mtimeMs >= filters.untilExclusiveMs;
    if (skippedBySince || skippedByUntil) {
      summary.skippedByDateCount += 1;
      appendItem({
        ...common,
        outcome: "skipped",
        distillStatus: "not_applicable",
        errorStage: "filter",
        errorReason: skippedBySince
          ? "Session transcript mtime is before --since"
          : "Session transcript mtime is after --until"
      });
      continue;
    }
    if (filters?.maxFileSizeBytes !== undefined && candidate.size > filters.maxFileSizeBytes) {
      summary.skippedBySizeCount += 1;
      appendItem({
        ...common,
        outcome: "skipped",
        distillStatus: "not_applicable",
        errorStage: "filter",
        errorReason: "Session transcript size exceeds --max-file-size"
      });
      continue;
    }

    summary.matchedCount += 1;
    summary.matchedBytes += candidate.size;
    if (filters?.limit !== undefined && acceptedMatchedCount >= filters.limit) {
      summary.limitedCount += 1;
      appendItem({
        ...common,
        outcome: "skipped",
        distillStatus: "not_applicable",
        errorStage: "filter",
        errorReason: "Session skipped by --limit"
      });
      continue;
    }
    acceptedMatchedCount += 1;

    const threadId = stableThreadId(candidate.agent, candidate.sessionId);
    let rawText: string;
    try {
      rawText = await readFile(candidate.filePath, "utf8");
    } catch (error) {
      appendItem({
        ...common, outcome: "failed", distillStatus: "not_requested",
        errorStage: "read", errorReason: sanitizeHistoryImportError(error)
      });
      continue;
    }
    const fingerprint = createHash("sha256").update(rawText).digest("hex");

    let normalized: ReturnType<typeof normalizeJsonlSession>;
    try {
      normalized = normalizeJsonlSession({
        source: candidate.agent,
        inputPath: candidate.filePath,
        rawText,
        id: threadId,
        title: `${candidate.agent} session ${candidate.sessionId}`
      });
    } catch (error) {
      appendItem({
        ...common, fingerprint, outcome: "failed", distillStatus: "not_requested",
        errorStage: "parse", errorReason: sanitizeHistoryImportError(error)
      });
      continue;
    }

    let captured: CapturePreview;
    try {
      captured = captureSession(options.db, {
        id: normalized.id, projectId: options.project.id, title: normalized.title, source: normalized.source,
        rawFormat: normalized.rawFormat, rawText: normalized.rawText,
        checkpoint: {agent: candidate.agent, sessionId: candidate.sessionId as string,
          transcriptPath: candidate.filePath, size: candidate.size, mtimeMs: candidate.mtimeMs}
      }, {preview: dryRun});
    } catch (error) {
      appendItem({
        ...common, fingerprint, threadId: getThread(options.db, options.project.id, threadId)?.id,
        outcome: "failed", distillStatus: "not_requested", errorStage: "database", errorReason: sanitizeHistoryImportError(error)
      });
      continue;
    }
    const previous = findLatestHistoryImportItem(
      options.db, options.project.id, candidate.agent, candidate.sessionId
    );
    const sameMetadata = previous?.fingerprint === fingerprint &&
      previous.filePath === candidate.filePath &&
      previous.cwd === candidate.cwd;
    const outcome: HistoryImportOutcome = captured.outcome === "unchanged" && previous && !sameMetadata
      ? "updated" : captured.outcome;

    if (outcome === "unchanged") {
      appendItem({
        ...common, fingerprint, threadId, outcome, distillStatus: "not_applicable"
      });
      continue;
    }

    let distillStatus: HistoryDistillStatus = "not_requested";
    let errorStage: HistoryImportErrorStage | undefined;
    let errorReason: string | undefined;
    if (distill && !dryRun) {
      try {
        enqueueDistillJob(options.db, options.project.id, threadId, "cli");
        distillStatus = "queued";
      } catch (error) {
        distillStatus = "failed";
        errorStage = "distill";
        errorReason = sanitizeHistoryImportError(error);
      }
    }
    appendItem({
      ...common, fingerprint, threadId, outcome, distillStatus, errorStage, errorReason
    });
  }

  const hasErrors = counts.failed > 0 || items.some((item) => item.distillStatus === "failed");
  const finalRun = run
    ? finishHistoryImportRun(options.db, run.id, counts, { hasErrors })
    : undefined;
  const finishedAt = finalRun?.finishedAt ?? new Date().toISOString();
  return {
    runId: run?.id,
    dryRun,
    projectRoot: normalizeProjectPath(options.projectRoot),
    agents: [...options.agents],
    rootAliases: aliases,
    status: finalRun?.status ?? (hasErrors ? "completed_with_errors" : "completed"),
    startedAt,
    finishedAt,
    counts,
    summary: finalizeSummary(summary),
    items
  };
}
