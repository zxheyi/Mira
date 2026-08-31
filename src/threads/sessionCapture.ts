import type Database from "better-sqlite3";
import { isAbsolute } from "node:path";
import { getCaptureCursor, saveCaptureCursor, type SaveCaptureCursorInput } from "../integrations/captureCursorStore.js";
import { stableThreadId } from "../integrations/threadIdentity.js";
import { getThread, saveThread, type SaveThreadInput, type Thread } from "./threadStore.js";

export type SessionCaptureInput = SaveThreadInput & {
  checkpoint?: Omit<SaveCaptureCursorInput, "projectId">;
};
export type CapturePreview = {outcome: "imported" | "updated" | "unchanged"; thread?: Thread};
export type CaptureResult = CapturePreview & {thread: Thread};

/** Adapters normalize/validate host files; this interface owns persistence and checkpoint atomicity.
 * Capturing evidence never extracts or approves formal memory.
 */
export function captureSession(db: Database.Database, input: SessionCaptureInput): CaptureResult;
export function captureSession(db: Database.Database, input: SessionCaptureInput, options: {preview: boolean}): CapturePreview;
export function captureSession(db: Database.Database, input: SessionCaptureInput, options: {preview?: boolean} = {}): CapturePreview {
  for (const field of ["id", "projectId", "title", "source", "rawText"] as const) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`Session ${field} is required`);
  }
  if (input.rawFormat !== "markdown" && input.rawFormat !== "jsonl") throw new Error("Unsupported session raw format");
  const checkpoint = input.checkpoint;
  if (checkpoint) {
    if ((checkpoint.agent !== "codex" && checkpoint.agent !== "claude-code") ||
      !checkpoint.sessionId?.trim() || checkpoint.agent !== input.source ||
      input.id !== stableThreadId(checkpoint.agent, checkpoint.sessionId)) {
      throw new Error("Capture checkpoint must match the session source and stable Thread identity");
    }
    if (!isAbsolute(checkpoint.transcriptPath) || !Number.isSafeInteger(checkpoint.size) || checkpoint.size < 0 ||
      !Number.isFinite(checkpoint.mtimeMs) || checkpoint.mtimeMs < 0) throw new Error("Invalid capture checkpoint metadata");
  }
  const execute = (): CapturePreview => {
    const owner = db.prepare("select project_id from threads where id = ?").get(input.id) as {project_id: string} | undefined;
    if (owner && owner.project_id !== input.projectId) throw new Error(`Thread belongs to a different project: ${input.id}`);
    const existing = getThread(db, input.projectId, input.id);
    const previous = checkpoint && getCaptureCursor(db, input.projectId, checkpoint.agent, checkpoint.sessionId);
    if (checkpoint && previous?.transcriptPath === checkpoint.transcriptPath && previous.mtimeMs > checkpoint.mtimeMs) {
      throw new Error("Stale capture checkpoint; read the transcript again before retrying");
    }
    const unchanged = existing && existing.title === input.title && existing.source === input.source &&
      existing.rawFormat === input.rawFormat && existing.rawText === input.rawText;
    const outcome = !existing ? "imported" : unchanged ? "unchanged" : "updated";
    if (options.preview) return {outcome, thread: existing};
    const {checkpoint: _checkpoint, ...threadInput} = input;
    const thread = unchanged ? existing : saveThread(db, threadInput);
    if (checkpoint) {
      if (!previous || previous.transcriptPath !== checkpoint.transcriptPath || previous.size !== checkpoint.size || previous.mtimeMs !== checkpoint.mtimeMs) {
        saveCaptureCursor(db, {...checkpoint, projectId: input.projectId});
      }
    }
    return {outcome, thread};
  };
  return options.preview ? execute() : db.transaction(execute)();
}
