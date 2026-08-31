import type Database from "better-sqlite3";
import {
  type AddMemoryInput,
  type Memory,
  type MemoryKind
} from "../memory/memoryStore.js";
import { curateMemory, type CurationAuthority } from "../memory/curationService.js";

type ThreadTextRow = {
  raw_text: string;
};

type Section = {
  kind: MemoryKind;
  lines: string[];
};

const TRANSCRIPT_ROLE_HEADINGS = new Set(["developer", "user", "assistant", "system", "tool", "message"]);
const MEMORY_HEADING_KINDS = new Map<string, MemoryKind>([
  ["key decisions", "decision"],
  ["decisions", "decision"],
  ["decision log", "decision"],
  ["conventions", "convention"],
  ["coding conventions", "convention"],
  ["project conventions", "convention"],
  ["architecture", "architecture"],
  ["architecture decisions", "architecture"],
  ["system design", "architecture"],
  ["preferences", "preference"],
  ["user preferences", "preference"],
  ["constraints", "constraint"],
  ["constraint", "constraint"],
  ["project constraints", "constraint"],
  ["tasks", "task"],
  ["task", "task"],
  ["current tasks", "task"],
  ["facts", "fact"],
  ["fact", "fact"],
  ["project facts", "fact"],
  ["failed attempts", "failed_attempt"],
  ["failed attempt", "failed_attempt"],
  ["failures", "failed_attempt"],
  ["what failed", "failed_attempt"],
  ["what we learned", "lesson"],
  ["lessons", "lesson"],
  ["lessons learned", "lesson"],
  ["learned", "lesson"],
  ["notes", "note"],
  ["summary", "note"],
  ["context", "note"],
  ["next steps", "todo"],
  ["todos", "todo"],
  ["todo", "todo"]
]);

function kindForHeading(heading: string, level: number): MemoryKind | undefined {
  const normalized = heading.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

  if (level === 1 || TRANSCRIPT_ROLE_HEADINGS.has(normalized)) {
    return undefined;
  }

  return MEMORY_HEADING_KINDS.get(normalized);
}

function importanceForKind(kind: MemoryKind): number {
  switch (kind) {
    case "decision":
    case "architecture":
      return 8;
    case "convention":
    case "preference":
    case "constraint":
      return 7;
    case "failed_attempt":
    case "lesson":
      return 6;
    case "task":
    case "fact":
    case "todo":
      return 5;
    case "note":
      return 4;
  }
}

function titleFromContent(content: string): string {
  return content
    .split(/(?<=[.!?])\s+/)[0]
    .replace(/[.!?]+$/g, "")
    .trim()
    .slice(0, 80);
}

function entriesFromSection(lines: string[]): string[] {
  const bulletEntries: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const bullet = line.trim().match(/^(?:[-*]|\d+[.)])\s+(?<content>.+)$/)?.groups?.content?.trim();
    if (bullet) {
      bulletEntries.push(bullet);
      continue;
    }

    const continuation = line.match(/^\s{2,}(?<content>\S.*)$/)?.groups?.content?.trim();
    if (continuation && bulletEntries.length > 0) {
      bulletEntries[bulletEntries.length - 1] = `${bulletEntries[bulletEntries.length - 1]} ${continuation}`;
    }
  }

  if (bulletEntries.length > 0) {
    return bulletEntries;
  }

  const paragraph = lines.map((line) => line.trim()).filter(Boolean).join(" ").trim();
  return paragraph ? [paragraph] : [];
}

export function distillMemoriesFromText(
  projectId: string,
  threadId: string,
  rawText: string
): AddMemoryInput[] {
  const sections: Section[] = [];
  let current: Section | undefined;

  for (const line of rawText.split(/\r?\n/)) {
    const headingMatch = line.match(/^(?<marks>#{1,6})\s+(?<title>.+)$/);
    const heading = headingMatch?.groups?.title;

    if (heading) {
      const kind = kindForHeading(heading, headingMatch?.groups?.marks.length ?? 1);
      current = kind ? { kind, lines: [] } : undefined;
      if (current) {
        sections.push(current);
      }
      continue;
    }

    current?.lines.push(line);
  }

  return sections.flatMap((section) =>
    entriesFromSection(section.lines).map((content) => ({
      projectId,
      threadId,
      title: titleFromContent(content),
      kind: section.kind,
      content,
      source: `distill:${threadId}`,
      confidence: 1,
      importance: importanceForKind(section.kind)
    }))
  );
}

export function distillThreadMemories(
  db: Database.Database,
  projectId: string,
  threadId: string,
  authority?: CurationAuthority
): Memory[] {
  const row = db
    .prepare("select raw_text from threads where project_id = ? and id = ?")
    .get(projectId, threadId) as ThreadTextRow | undefined;

  if (!row) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const inputs = distillMemoriesFromText(projectId, threadId, row.raw_text);
  return curateMemory(db, {operation: "replace_thread", projectId, threadId, method: "deterministic",
    memories: inputs.map(({title, kind, content, confidence, importance}) => ({title, kind, content, confidence, importance}))
  }, authority);
}
