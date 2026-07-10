import type Database from "better-sqlite3";
import {
  addMemory,
  clearMemoriesForThread,
  type AddMemoryInput,
  type Memory,
  type MemoryKind
} from "../memory/memoryStore.js";

type ThreadTextRow = {
  raw_text: string;
};

type Section = {
  kind: MemoryKind;
  lines: string[];
};

function kindForHeading(heading: string): MemoryKind | undefined {
  const normalized = heading.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

  if (["key decisions", "decisions", "decision log"].includes(normalized)) {
    return "decision";
  }
  if (["conventions", "coding conventions", "project conventions"].includes(normalized)) {
    return "convention";
  }
  if (["architecture", "architecture decisions", "system design"].includes(normalized)) {
    return "architecture";
  }
  if (["preferences", "user preferences"].includes(normalized)) {
    return "preference";
  }
  if (["what we learned", "lessons", "lessons learned", "learned"].includes(normalized)) {
    return "lesson";
  }
  if (["notes", "summary", "context"].includes(normalized)) {
    return "note";
  }
  if (["next steps", "todos", "todo"].includes(normalized)) {
    return "todo";
  }

  return undefined;
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
    case "lesson":
      return 6;
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
  const bulletEntries = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^(?:[-*]|\d+[.)])\s+(?<content>.+)$/)?.groups?.content?.trim())
    .filter((entry): entry is string => Boolean(entry));

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
    const heading = line.match(/^#{1,6}\s+(?<title>.+)$/)?.groups?.title;

    if (heading) {
      const kind = kindForHeading(heading);
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
  threadId: string
): Memory[] {
  const row = db
    .prepare("select raw_text from threads where project_id = ? and id = ?")
    .get(projectId, threadId) as ThreadTextRow | undefined;

  if (!row) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  clearMemoriesForThread(db, projectId, threadId);
  return distillMemoriesFromText(projectId, threadId, row.raw_text).map((memory) => addMemory(db, memory));
}
