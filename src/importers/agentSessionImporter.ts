import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export type AgentSessionSource = "codex" | "claude-code" | "markdown";
export type AgentSessionRawFormat = "markdown" | "jsonl";
export type AgentSessionImportFormat = "auto" | AgentSessionRawFormat;

export type AgentSessionImportInput = {
  source: string;
  inputPath: string;
  format?: string;
  id?: string;
  title?: string;
};

export type MarkdownSessionInput = AgentSessionImportInput & {
  rawText: string;
};

export type NormalizedAgentSession = {
  id: string;
  source: AgentSessionSource;
  title: string;
  rawFormat: AgentSessionRawFormat;
  rawText: string;
  metadata: {
    inputPath: string;
  };
};

const SUPPORTED_SOURCES = new Set<AgentSessionSource>(["codex", "claude-code", "markdown"]);
const SUPPORTED_FORMATS = new Set<AgentSessionImportFormat>(["auto", "markdown", "jsonl"]);

type TranscriptMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

function assertSupportedSource(source: string): AgentSessionSource {
  if (!SUPPORTED_SOURCES.has(source as AgentSessionSource)) {
    throw new Error(`Unsupported agent session source: ${source}`);
  }

  return source as AgentSessionSource;
}

function inferTitle(inputPath: string, rawText: string): string {
  const h1 = rawText.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (h1) {
    return h1;
  }

  const fileName = basename(inputPath);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function inferFileTitle(inputPath: string): string {
  const fileName = basename(inputPath);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function generateStableId(source: AgentSessionSource, inputPath: string, rawText: string): string {
  const fileSlug = slug(basename(inputPath, extname(inputPath))) || "session";
  const hash = createHash("sha256").update(`${source}\n${resolve(inputPath)}\n${rawText}`).digest("hex").slice(0, 12);
  return `${source}_${fileSlug}_${hash}`;
}

function assertSupportedFormat(format: string | undefined): AgentSessionImportFormat {
  const normalized = format ?? "auto";
  if (!SUPPORTED_FORMATS.has(normalized as AgentSessionImportFormat)) {
    throw new Error(`Unsupported agent session format: ${normalized}`);
  }
  return normalized as AgentSessionImportFormat;
}

function detectFormat(inputPath: string, format: string | undefined): AgentSessionRawFormat {
  const normalized = assertSupportedFormat(format);
  if (normalized === "markdown" || normalized === "jsonl") {
    return normalized;
  }

  return extname(inputPath).toLowerCase() === ".jsonl" ? "jsonl" : "markdown";
}

function parseJsonl(rawText: string): unknown[] {
  return rawText.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    try {
      return [JSON.parse(trimmed) as unknown];
    } catch {
      throw new Error(`Invalid JSONL on line ${index + 1}`);
    }
  });
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function textFromContentBlock(block: unknown): string | undefined {
  if (typeof block === "string") {
    return block;
  }

  const object = getObject(block);
  if (!object) {
    return undefined;
  }

  if (typeof object.text === "string") {
    return object.text;
  }

  if (typeof object.content === "string") {
    return object.content;
  }

  const type = typeof object.type === "string" ? object.type : undefined;
  if (type === "tool_use" || type === "tool_call" || type === "function_call") {
    const name =
      typeof object.name === "string"
        ? object.name
        : typeof object.tool_name === "string"
          ? object.tool_name
          : "unknown";
    const input = object.input ?? object.arguments;
    const renderedInput = input === undefined ? "" : `\n\n${JSON.stringify(input, null, 2)}`;
    return `Tool: ${name}${renderedInput}`;
  }

  return undefined;
}

function extractContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(textFromContentBlock).filter((text): text is string => Boolean(text?.trim())).join("\n\n");
  }

  return textFromContentBlock(value) ?? "";
}

function extractTranscriptMessage(record: unknown): TranscriptMessage | undefined {
  const object = getObject(record);
  if (!object) {
    return undefined;
  }

  const nestedMessage = getObject(object.message);
  const source = nestedMessage ?? object;
  const role =
    typeof source.role === "string"
      ? source.role
      : typeof object.role === "string"
        ? object.role
        : typeof object.type === "string"
          ? object.type
          : "message";
  const rawContent = source.content ?? object.content ?? source.text ?? object.text;
  const content = extractContent(rawContent);

  if (!content.trim()) {
    return undefined;
  }

  const timestamp =
    typeof object.timestamp === "string"
      ? object.timestamp
      : typeof object.created_at === "string"
        ? object.created_at
        : typeof object.createdAt === "string"
          ? object.createdAt
          : undefined;

  return { role, content, timestamp };
}

function renderTranscriptMarkdown(input: {
  title: string;
  source: AgentSessionSource;
  messages: TranscriptMessage[];
}): string {
  const lines = [`# ${input.title}`, "", `Source: ${input.source}`, "Format: jsonl", ""];

  for (const message of input.messages) {
    lines.push(`## ${message.role}`, "");
    if (message.timestamp) {
      lines.push(`Time: ${message.timestamp}`, "");
    }
    lines.push(message.content, "");
  }

  return lines.join("\n").trimEnd();
}

export function normalizeMarkdownSession(input: MarkdownSessionInput): NormalizedAgentSession {
  const source = assertSupportedSource(input.source);
  const inputPath = resolve(input.inputPath);

  return {
    id: input.id ?? generateStableId(source, inputPath, input.rawText),
    source,
    title: input.title ?? inferTitle(inputPath, input.rawText),
    rawFormat: "markdown",
    rawText: input.rawText,
    metadata: { inputPath }
  };
}

export function normalizeJsonlSession(input: MarkdownSessionInput): NormalizedAgentSession {
  const source = assertSupportedSource(input.source);
  const inputPath = resolve(input.inputPath);
  const title = input.title ?? inferFileTitle(inputPath);
  const messages = parseJsonl(input.rawText)
    .map(extractTranscriptMessage)
    .filter((message): message is TranscriptMessage => Boolean(message));

  if (messages.length === 0) {
    throw new Error("No messages found in JSONL transcript");
  }

  return {
    id: input.id ?? generateStableId(source, inputPath, input.rawText),
    source,
    title,
    rawFormat: "jsonl",
    rawText: renderTranscriptMarkdown({ title, source, messages }),
    metadata: { inputPath }
  };
}

export async function importAgentSessionFromFile(input: AgentSessionImportInput): Promise<NormalizedAgentSession> {
  const inputPath = resolve(input.inputPath);
  const rawText = await readFile(inputPath, "utf8");
  const format = detectFormat(inputPath, input.format);

  if (format === "jsonl") {
    return normalizeJsonlSession({ ...input, inputPath, rawText });
  }

  return normalizeMarkdownSession({ ...input, inputPath, rawText });
}
