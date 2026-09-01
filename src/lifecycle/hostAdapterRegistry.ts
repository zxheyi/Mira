import { z } from "zod";

export const MIRA_HOSTS = ["codex", "claude-code", "cursor", "cli", "mcp", "ui"] as const;
export type MiraHost = (typeof MIRA_HOSTS)[number];
export const INVOCATION_TRANSPORTS = ["native", "cli", "mcp", "ui"] as const;
export type InvocationTransport = (typeof INVOCATION_TRANSPORTS)[number];
export type TurnOutcomeStatus = "succeeded" | "failed" | "cancelled";

export type ContextRequest = {
  memoryLimit?: number;
  maxCharacters?: number;
  maxTokens?: number;
};

export type HostTranscript = {
  threadId: string;
  title: string;
  rawFormat: "markdown" | "jsonl";
  rawText: string;
  checkpoint?: {
    agent: "codex" | "claude-code";
    sessionId: string;
    transcriptPath: string;
    size: number;
    mtimeMs: number;
  };
};

export type BeforeTurnCommand = {
  host: MiraHost;
  transport?: InvocationTransport;
  hostSessionId: string;
  hostTurnId: string;
  query: string;
  taskId?: string;
  context?: ContextRequest;
};

export type AfterTurnCommand = {
  host: MiraHost;
  transport?: InvocationTransport;
  hostSessionId: string;
  hostTurnId: string;
  query: string;
  response: string;
  outcomeStatus: TurnOutcomeStatus;
  taskId?: string;
  transcript?: HostTranscript;
};

export type HostAdapterDescriptor = {
  host: MiraHost;
  label: string;
  adapterRole: "source_host" | "transport";
  beforeTurn: true;
  afterTurn: true;
  nativeGranularity: "session" | "turn";
};

const identity = z.string().trim().min(1).max(500);
const body = z.string().trim().min(1).max(50_000);
const task = z.string().trim().min(1).max(500).optional();
const contextSchema = z.object({
  memoryLimit: z.number().int().min(1).max(50).optional(),
  maxCharacters: z.number().int().min(1).max(1_000_000).optional(),
  maxTokens: z.number().int().min(25).max(250_000).optional()
}).strict().optional();
const transcriptSchema = z.object({
  threadId: identity,
  title: z.string().trim().min(1).max(500),
  rawFormat: z.enum(["markdown", "jsonl"]),
  rawText: body,
  checkpoint: z.object({
    agent: z.enum(["codex", "claude-code"]),
    sessionId: identity,
    transcriptPath: z.string().trim().min(1).max(4000),
    size: z.number().int().min(0),
    mtimeMs: z.number().finite().min(0)
  }).strict().optional()
}).strict().optional();

const camelBefore = z.object({
  sessionId: identity,
  turnId: identity,
  query: body,
  taskId: task,
  context: contextSchema
}).strict();
const snakeBefore = z.object({
  session_id: identity,
  turn_id: identity,
  prompt: body,
  task_id: task,
  context: contextSchema
}).strict();
const camelAfter = z.object({
  sessionId: identity,
  turnId: identity,
  query: body,
  response: body,
  status: z.enum(["succeeded", "failed", "cancelled"]),
  taskId: task,
  transcript: transcriptSchema
}).strict();
const snakeAfter = z.object({
  session_id: identity,
  turn_id: identity,
  prompt: body,
  response: body,
  status: z.enum(["succeeded", "failed", "cancelled"]),
  task_id: task,
  transcript: transcriptSchema
}).strict();

const descriptors: HostAdapterDescriptor[] = [
  {host: "codex", label: "Codex", adapterRole:"source_host",beforeTurn: true, afterTurn: true, nativeGranularity: "session"},
  {host: "claude-code", label: "Claude Code", adapterRole:"source_host",beforeTurn: true, afterTurn: true, nativeGranularity: "session"},
  {host: "cursor", label: "Cursor", adapterRole:"source_host",beforeTurn: true, afterTurn: true, nativeGranularity: "session"},
  {host: "cli", label: "CLI", adapterRole:"transport",beforeTurn: true, afterTurn: true, nativeGranularity: "turn"},
  {host: "mcp", label: "MCP", adapterRole:"transport",beforeTurn: true, afterTurn: true, nativeGranularity: "turn"},
  {host: "ui", label: "Viewer", adapterRole:"transport",beforeTurn: true, afterTurn: true, nativeGranularity: "turn"}
];

function requireHost(host: string): MiraHost {
  if (!(MIRA_HOSTS as readonly string[]).includes(host)) throw new Error("Unsupported Host: " + host);
  return host as MiraHost;
}

function invalidHostInput(error: z.ZodError): Error {
  return new Error("Invalid Host input: " + error.issues.map(issue =>
    `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
}

export type HostAdapterRegistry = {
  list(): HostAdapterDescriptor[];
  normalizeBeforeTurn(host: string, input: unknown, transport?: InvocationTransport): BeforeTurnCommand;
  normalizeAfterTurn(host: string, input: unknown, transport?: InvocationTransport): AfterTurnCommand;
};

export function createHostAdapterRegistry(): HostAdapterRegistry {
  return {
    list: () => descriptors.map(descriptor => ({...descriptor})),
    normalizeBeforeTurn(hostName, input, transport) {
      const host = requireHost(hostName);
      const parsed = z.union([camelBefore, snakeBefore]).safeParse(input);
      if (!parsed.success) throw invalidHostInput(parsed.error);
      if ("sessionId" in parsed.data) {
        return {host, ...(transport ? {transport} : {}), hostSessionId: parsed.data.sessionId, hostTurnId: parsed.data.turnId,
          query: parsed.data.query, ...(parsed.data.taskId ? {taskId: parsed.data.taskId} : {}),
          ...(parsed.data.context ? {context: parsed.data.context} : {})};
      }
      return {host, ...(transport ? {transport} : {}), hostSessionId: parsed.data.session_id, hostTurnId: parsed.data.turn_id,
        query: parsed.data.prompt, ...(parsed.data.task_id ? {taskId: parsed.data.task_id} : {}),
        ...(parsed.data.context ? {context: parsed.data.context} : {})};
    },
    normalizeAfterTurn(hostName, input, transport) {
      const host = requireHost(hostName);
      const parsed = z.union([camelAfter, snakeAfter]).safeParse(input);
      if (!parsed.success) throw invalidHostInput(parsed.error);
      if ("sessionId" in parsed.data) {
        return {host, ...(transport ? {transport} : {}), hostSessionId: parsed.data.sessionId, hostTurnId: parsed.data.turnId,
          query: parsed.data.query, response: parsed.data.response, outcomeStatus: parsed.data.status,
          ...(parsed.data.taskId ? {taskId: parsed.data.taskId} : {}),
          ...(parsed.data.transcript ? {transcript: parsed.data.transcript} : {})};
      }
      return {host, ...(transport ? {transport} : {}), hostSessionId: parsed.data.session_id, hostTurnId: parsed.data.turn_id,
        query: parsed.data.prompt, response: parsed.data.response, outcomeStatus: parsed.data.status,
        ...(parsed.data.task_id ? {taskId: parsed.data.task_id} : {}),
        ...(parsed.data.transcript ? {transcript: parsed.data.transcript} : {})};
    }
  };
}
