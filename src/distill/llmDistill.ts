import type Database from "better-sqlite3";
import {
  addMemory,
  MEMORY_KINDS,
  type AddMemoryInput,
  type Memory,
  type MemoryKind
} from "../memory/memoryStore.js";
import { archiveStaleMemoriesForThread } from "../memory/memoryLifecycleStore.js";
import { sanitizeThreadTextForDistill } from "./transcriptSanitizer.js";

type ThreadTextRow = {
  raw_text: string;
};

export type LlmDistillPromptInput = {
  threadId: string;
  rawText: string;
};

export type LlmMemoryCandidate = {
  title: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
};

type RawCandidate = {
  title?: unknown;
  kind?: unknown;
  content?: unknown;
  confidence?: unknown;
  importance?: unknown;
};

const MAX_LLM_MEMORY_CANDIDATES = 50;
const MAX_LLM_MEMORY_TITLE_LENGTH = 200;
const MAX_LLM_MEMORY_CONTENT_LENGTH = 10000;

function getThreadRawText(db: Database.Database, projectId: string, threadId: string): string {
  const row = db
    .prepare("select raw_text from threads where project_id = ? and id = ?")
    .get(projectId, threadId) as ThreadTextRow | undefined;

  if (!row) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  return row.raw_text;
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && MEMORY_KINDS.includes(value as MemoryKind);
}

function parseJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return JSON.parse(fenced ?? trimmed) as unknown;
}

function numberOrDefault(value: unknown, defaultValue: number, min: number, max: number, label: string): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}`);
  }
  return value;
}

function normalizeCandidate(candidate: RawCandidate): LlmMemoryCandidate {
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    throw new Error("Candidate title is required");
  }
  const title = candidate.title.trim();
  if (title.length > MAX_LLM_MEMORY_TITLE_LENGTH) {
    throw new Error(`Candidate title must be at most ${MAX_LLM_MEMORY_TITLE_LENGTH} characters`);
  }
  if (!isMemoryKind(candidate.kind)) {
    throw new Error(`Unsupported memory kind: ${String(candidate.kind)}`);
  }
  if (typeof candidate.content !== "string" || !candidate.content.trim()) {
    throw new Error("Candidate content is required");
  }
  const content = candidate.content.trim();
  if (content.length > MAX_LLM_MEMORY_CONTENT_LENGTH) {
    throw new Error(`Candidate content must be at most ${MAX_LLM_MEMORY_CONTENT_LENGTH} characters`);
  }

  return {
    title,
    kind: candidate.kind,
    content,
    confidence: numberOrDefault(candidate.confidence, 0.8, 0, 1, "confidence"),
    importance: numberOrDefault(candidate.importance, 5, 1, 10, "importance")
  };
}

export function buildLlmDistillPrompt(input: LlmDistillPromptInput): string {
  return [
    "# Mira LLM Memory Distill",
    "",
    `Thread id: ${input.threadId}`,
    "",
    "Extract durable project memories from the thread below.",
    "Return strict JSON only. Do not include Markdown explanations.",
    "",
    "Allowed memory kinds:",
    MEMORY_KINDS.map((kind) => `- ${kind}`).join("\n"),
    "",
    "JSON schema:",
    "```json",
    JSON.stringify(
      {
        memories: [
          {
            title: "Short title",
            kind: "decision",
            content: "One stable project memory.",
            confidence: 0.8,
            importance: 5
          }
        ]
      },
      null,
      2
    ),
    "```",
    "",
    "Rules:",
    "- Keep each memory short and stable.",
    "- Prefer decisions, architecture, conventions, preferences, lessons, constraints, todos, and notes.",
    "- Do not include secrets, tokens, private credentials, or speculative guesses.",
    "- Use confidence from 0 to 1 and importance from 1 to 10.",
    "",
    "Thread text:",
    "```markdown",
    sanitizeThreadTextForDistill(input.rawText),
    "```"
  ].join("\n");
}

export function buildLlmDistillPromptForThread(db: Database.Database, projectId: string, threadId: string): string {
  return buildLlmDistillPrompt({ threadId, rawText: getThreadRawText(db, projectId, threadId) });
}

export function parseLlmMemoryCandidates(rawText: string): LlmMemoryCandidate[] {
  const parsed = parseJsonPayload(rawText);
  const rawCandidates = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { memories?: unknown }).memories)
      ? (parsed as { memories: unknown[] }).memories
      : undefined;

  if (!rawCandidates) {
    throw new Error("LLM distill output must be an array or an object with a memories array");
  }
  if (rawCandidates.length > MAX_LLM_MEMORY_CANDIDATES) {
    throw new Error(`LLM distill output must contain at most ${MAX_LLM_MEMORY_CANDIDATES} memories`);
  }

  return rawCandidates.map((candidate) => normalizeCandidate(candidate as RawCandidate));
}

export function applyLlmDistillCandidates(
  db: Database.Database,
  projectId: string,
  threadId: string,
  candidates: LlmMemoryCandidate[]
): Memory[] {
  getThreadRawText(db, projectId, threadId);
  if (candidates.length === 0) {
    return [];
  }

  return db.transaction(() => {
    archiveStaleMemoriesForThread(
      db,
      projectId,
      threadId,
      candidates,
      [`distill:${threadId}`, `llm-distill:${threadId}`],
      `llm-distill:${threadId}`,
      "Replaced by a newer LLM distill result"
    );

    return candidates.map((candidate) => {
      const input: AddMemoryInput = {
        projectId,
        threadId,
        title: candidate.title,
        kind: candidate.kind,
        content: candidate.content,
        source: `llm-distill:${threadId}`,
        confidence: candidate.confidence,
        importance: candidate.importance
      };
      return addMemory(db, input);
    });
  })();
}
