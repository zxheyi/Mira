import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { submitMemoryCandidates } from "./candidateService.js";
import {
  claimNextDistillJob,
  completeDistillJob,
  failDistillJob,
  sanitizeDistillError,
  type DistillJob
} from "./distillJobStore.js";
import type { DistillProvider } from "./openAiCompatibleProvider.js";
import { assertNoSensitiveInformation } from "./candidatePolicy.js";
import { sanitizeThreadTextForDistill } from "./transcriptSanitizer.js";

export type DistillWorkerResult =
  | { status: "idle" }
  | { status: "completed" | "skipped_stale"; job: DistillJob; candidateCount: number }
  | { status: "failed"; job: DistillJob; error: string };

export async function runNextDistillJob(
  db: Database.Database,
  projectId: string,
  provider: DistillProvider,
  sourceModel: string
): Promise<DistillWorkerResult> {
  const job = claimNextDistillJob(db, projectId);
  if (!job) return { status: "idle" };

  try {
    const thread = db.prepare("select raw_text from threads where project_id = ? and id = ?")
      .get(job.projectId, job.threadId) as { raw_text: string } | undefined;
    if (!thread) throw new Error(`Thread not found: ${job.threadId}`);
    const currentHash = createHash("sha256").update(thread.raw_text).digest("hex");
    if (currentHash !== job.inputHash) {
      completeDistillJob(db, job.id);
      return { status: "skipped_stale", job, candidateCount: 0 };
    }

    assertNoSensitiveInformation(thread.raw_text, "Thread");
    const sanitizedRawText = sanitizeThreadTextForDistill(thread.raw_text);
    const candidates = await provider.distill({ threadId: job.threadId, rawText: sanitizedRawText });
    const latestThread = db.prepare("select raw_text from threads where project_id = ? and id = ?")
      .get(job.projectId, job.threadId) as { raw_text: string } | undefined;
    const latestHash = latestThread
      ? createHash("sha256").update(latestThread.raw_text).digest("hex")
      : undefined;
    if (latestHash !== job.inputHash) {
      completeDistillJob(db, job.id);
      return { status: "skipped_stale", job, candidateCount: 0 };
    }
    if (candidates.length > 0) {
      submitMemoryCandidates(db, {
        projectId: job.projectId,
        threadId: job.threadId,
        jobId: job.id,
        expectedThreadInputHash: job.inputHash,
        sourceAgent: "provider",
        sourceModel,
        extractionMethod: "provider",
        candidates
      });
    }
    completeDistillJob(db, job.id);
    return { status: "completed", job, candidateCount: candidates.length };
  } catch (error) {
    failDistillJob(db, job.id, error);
    return { status: "failed", job, error: sanitizeDistillError(error) };
  }
}
