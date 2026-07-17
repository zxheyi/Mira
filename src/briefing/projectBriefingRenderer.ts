import type { Memory } from "../memory/memoryStore.js";
import type { WorkingMemory } from "../workingMemory/workingMemoryStore.js";

export type ProjectBriefingRenderInput = {
  projectName: string;
  workingMemory: WorkingMemory[];
  memories: Memory[];
};

export type RenderedProjectBriefing = {
  markdown: string;
  sourceMemoryIds: string[];
  sourceThreadIds: string[];
  sourceWorkingMemoryIds: string[];
};

type BriefingEntry = {
  content: string;
  marker: string;
  memoryId?: string;
  threadId?: string;
  workingMemoryId?: string;
};

function memoryEntry(memory: Memory): BriefingEntry {
  const threadMarker = memory.threadId ? ` [thread:${memory.threadId}]` : "";
  return {
    content: memory.content.trim(),
    marker: `[memory:${memory.id}]${threadMarker}`,
    memoryId: memory.id,
    threadId: memory.threadId
  };
}

function workingEntry(memory: WorkingMemory): BriefingEntry {
  return {
    content: memory.content.trim(),
    marker: `[working:${memory.id}]`,
    workingMemoryId: memory.id
  };
}

function uniqueInOrder(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function renderProjectBriefing(input: ProjectBriefingRenderInput): RenderedProjectBriefing {
  const workingByKind = (kinds: WorkingMemory["kind"][]) =>
    input.workingMemory.filter((item) => kinds.includes(item.kind)).map(workingEntry);
  const memoriesByKind = (kinds: Memory["kind"][]) =>
    input.memories.filter((item) => kinds.includes(item.kind)).map(memoryEntry);
  const sections: Array<{ title: string; entries: BriefingEntry[] }> = [
    { title: "Current Goal", entries: workingByKind(["current_task"]) },
    { title: "Current Phase", entries: workingByKind(["current_phase"]) },
    {
      title: "Recent Decisions",
      entries: [...workingByKind(["recent_decision", "decision"]), ...memoriesByKind(["decision", "architecture"])]
    },
    { title: "Known Constraints", entries: memoriesByKind(["constraint"]) },
    { title: "Blockers", entries: workingByKind(["blocker"]) },
    { title: "Lessons and Failed Attempts", entries: memoriesByKind(["lesson", "failed_attempt"]) },
    { title: "Open Questions and Notes", entries: workingByKind(["note"]) },
    { title: "Next Actions", entries: [...workingByKind(["next_step"]), ...memoriesByKind(["task", "todo"])] }
  ];
  const included = sections.flatMap((section) => section.entries);
  const lines = [`# ${input.projectName} Project Briefing`, ""];

  if (included.length === 0) {
    lines.push("No current project context recorded.");
  } else {
    for (const section of sections) {
      if (section.entries.length === 0) continue;
      lines.push(`## ${section.title}`);
      for (const entry of section.entries) lines.push(`- ${entry.content} ${entry.marker}`);
      lines.push("");
    }
  }

  return {
    markdown: lines.join("\n").trimEnd() + "\n",
    sourceMemoryIds: uniqueInOrder(included.map((entry) => entry.memoryId)),
    sourceThreadIds: uniqueInOrder(included.map((entry) => entry.threadId)),
    sourceWorkingMemoryIds: uniqueInOrder(included.map((entry) => entry.workingMemoryId))
  };
}
