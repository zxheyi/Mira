import type Database from "better-sqlite3";
import {
  addMemory,
  type AddMemoryInput,
  type Memory,
  type MemoryKind
} from "../memory/memoryStore.js";
import { archiveStaleMemoriesForThread } from "../memory/memoryLifecycleStore.js";

type ThreadTextRow = {
  raw_text: string;
};

type Section = {
  kind: MemoryKind;
  lines: string[];
};

function kindForHeading(heading: string, level: number): MemoryKind | undefined {
  const normalized = heading.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

  if (level === 1 || ["user", "assistant", "system", "tool", "message"].includes(normalized)) {
    return undefined;
  }

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
  if (["constraints", "constraint", "project constraints"].includes(normalized)) {
    return "constraint";
  }
  if (["tasks", "task", "current tasks"].includes(normalized)) {
    return "task";
  }
  if (["facts", "fact", "project facts"].includes(normalized)) {
    return "fact";
  }
  if (["failed attempts", "failed attempt", "failures", "what failed"].includes(normalized)) {
    return "failed_attempt";
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

  return "note";
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
  threadId: string
): Memory[] {
  const row = db
    .prepare("select raw_text from threads where project_id = ? and id = ?")
    .get(projectId, threadId) as ThreadTextRow | undefined;

  if (!row) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const inputs = distillMemoriesFromText(projectId, threadId, row.raw_text);
  if (inputs.length === 0) {
    return [];
  }

  return db.transaction(() => {
    archiveStaleMemoriesForThread(
      db,
      projectId,
      threadId,
      inputs,
      [`distill:${threadId}`, `llm-distill:${threadId}`],
      `distill:${threadId}`,
      "Replaced by a newer deterministic distill result"
    );
    return inputs.map((memory) => addMemory(db, memory));
  })();
}
