import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export type AgentSessionSource = "codex" | "claude-code" | "markdown";
export type AgentSessionRawFormat = "markdown";

export type AgentSessionImportInput = {
  source: string;
  inputPath: string;
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

export async function importAgentSessionFromFile(input: AgentSessionImportInput): Promise<NormalizedAgentSession> {
  const inputPath = resolve(input.inputPath);
  const rawText = await readFile(inputPath, "utf8");
  return normalizeMarkdownSession({ ...input, inputPath, rawText });
}
