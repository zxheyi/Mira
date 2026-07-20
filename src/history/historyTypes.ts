import type { IntegrationAgent } from "../integrations/configInstaller.js";

export type HistoryAgent = IntegrationAgent;

export type HistorySessionCandidate = {
  agent: HistoryAgent;
  filePath: string;
  sessionId?: string;
  cwd?: string;
  size: number;
  mtimeMs: number;
  metadataError?: string;
  discoveryError?: string;
};

export const HISTORY_IMPORT_OUTCOMES = ["imported", "updated", "unchanged", "skipped", "failed"] as const;
export type HistoryImportOutcome = (typeof HISTORY_IMPORT_OUTCOMES)[number];

export const HISTORY_IMPORT_RUN_STATUSES = [
  "running", "completed", "completed_with_errors", "failed", "interrupted"
] as const;
export type HistoryImportRunStatus = (typeof HISTORY_IMPORT_RUN_STATUSES)[number];

export type HistoryDistillStatus = "not_requested" | "not_applicable" | "queued" | "failed";
export type HistoryImportErrorStage =
  | "scan" | "metadata" | "match" | "read" | "parse" | "normalize" | "database" | "distill" | "report";

export type HistoryImportCounts = {
  scanned: number;
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
};

export type HistoryImportRun = {
  id: string;
  projectId: string;
  status: HistoryImportRunStatus;
  agents: HistoryAgent[];
  rootAliases: string[];
  options: { distill: boolean };
  scannedCount: number;
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type HistoryImportItem = {
  id: string;
  runId?: string;
  agent: HistoryAgent;
  sessionId?: string;
  filePath: string;
  cwd?: string;
  fingerprint?: string;
  outcome: HistoryImportOutcome;
  threadId?: string;
  distillStatus: HistoryDistillStatus;
  errorStage?: HistoryImportErrorStage;
  errorReason?: string;
  createdAt: string;
};

export type HistoryImportReport = {
  runId?: string;
  dryRun: boolean;
  projectRoot: string;
  agents: HistoryAgent[];
  rootAliases: string[];
  status: HistoryImportRunStatus;
  startedAt: string;
  finishedAt: string;
  counts: HistoryImportCounts;
  items: HistoryImportItem[];
};
