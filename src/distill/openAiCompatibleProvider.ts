import { MEMORY_KINDS, type MemoryKind } from "../memory/memoryStore.js";
import type { MemoryCandidateInput } from "./candidateTypes.js";
import { assertNoSensitiveInformation } from "./candidatePolicy.js";

export type DistillProviderConfig = { baseUrl: string; model: string; apiKey?: string };
export type DistillProviderInput = { threadId: string; rawText: string };
export interface DistillProvider { distill(input: DistillProviderInput): Promise<MemoryCandidateInput[]>; }
export class RetryableProviderError extends Error {}

type RawCandidate = Record<string, unknown>;

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return JSON.parse(fenced ?? trimmed) as unknown;
}

function stringField(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Provider candidate ${name} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`Provider candidate ${name} must be at most ${max} characters`);
  return normalized;
}

function scoreField(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Provider candidate ${name} must be between 0 and 1`);
  }
  return value;
}

export function parseProviderCandidates(text: string): MemoryCandidateInput[] {
  const parsed = parseJsonObject(text);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    throw new Error("Provider output must be an object with a candidates array");
  }
  const raw = (parsed as { candidates: unknown[] }).candidates;
  if (raw.length > 50) throw new Error("Provider output must contain at most 50 candidates");
  return raw.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Provider candidate must be an object");
    const candidate = item as RawCandidate;
    if (typeof candidate.kind !== "string" || !(MEMORY_KINDS as readonly string[]).includes(candidate.kind)) {
      throw new Error(`Unsupported memory kind: ${String(candidate.kind)}`);
    }
    return {
      title: stringField(candidate.title, "title", 200),
      kind: candidate.kind as MemoryKind,
      content: stringField(candidate.content, "content", 10_000),
      evidence: stringField(candidate.evidence, "evidence", 4_000),
      confidence: scoreField(candidate.confidence, "confidence"),
      importance: scoreField(candidate.importance, "importance")
    };
  });
}

export function providerConfigFromEnv(env: NodeJS.ProcessEnv): DistillProviderConfig | undefined {
  const baseUrl = env.MIRA_LLM_BASE_URL?.trim().replace(/\/+$/, "");
  const model = env.MIRA_LLM_MODEL?.trim();
  if (!baseUrl || !model) return undefined;
  const apiKey = env.MIRA_LLM_API_KEY?.trim();
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
}

function buildPrompt(input: DistillProviderInput): string {
  return [
    "Extract durable project memories from this Agent thread.",
    "Return JSON only as {\"candidates\":[...]}. Each candidate requires title, kind, content, evidence, confidence, importance.",
    `Allowed kinds: ${MEMORY_KINDS.join(", ")}. confidence and importance range from 0 to 1.`,
    "Evidence must be an exact excerpt from the thread. Exclude credentials, guesses, transient chatter, and duplicated facts.",
    `Thread id: ${input.threadId}`,
    "Thread:",
    input.rawText
  ].join("\n\n");
}

export function createOpenAiCompatibleProvider(
  config: DistillProviderConfig,
  fetchImpl: typeof fetch = fetch
): DistillProvider {
  return {
    async distill(input) {
      assertNoSensitiveInformation(input.rawText, "Thread");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      timeout.unref();
      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: buildPrompt(input) }]
          })
        });
      } catch {
        throw new RetryableProviderError("Provider request failed or timed out");
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        let body = (await response.text()).slice(0, 500);
        if (config.apiKey) body = body.split(config.apiKey).join("[REDACTED]");
        const message = `Provider HTTP ${response.status}: ${body}`;
        if (response.status === 429 || response.status >= 500) throw new RetryableProviderError(message);
        throw new Error(message);
      }
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Provider response is missing message content");
      return parseProviderCandidates(content);
    }
  };
}
