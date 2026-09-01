import { z } from "zod";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { authorizeCuration, curateMemory } from "../memory/curationService.js";
import { MEMORY_KINDS, searchMemories } from "../memory/memoryStore.js";
import { createProject } from "../projects/projectStore.js";

const recallBaselineCaseSchema = z.object({
  id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(1000),
  memory: z.object({
    title: z.string().trim().min(1).max(500),
    kind: z.enum(MEMORY_KINDS),
    content: z.string().trim().min(1).max(50_000)
  }).strict()
}).strict();

export type RecallBaselineCase = z.infer<typeof recallBaselineCaseSchema>;

export type RecallBaselineResult = {
  id: string;
  question: string;
  expectedMemoryKey: string;
  rank: number | null;
  returnedMemoryKeys: string[];
};

export type RecallBaselineReport = {
  schemaVersion: 1;
  total: number;
  recallAt1: number;
  recallAt5: number;
  meanReciprocalRank: number;
  cases: RecallBaselineResult[];
};

export function runRecallBaseline(input: RecallBaselineCase[]): RecallBaselineReport {
  const cases = z.array(recallBaselineCaseSchema).parse(input);
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error("Duplicate case id: " + item.id);
    ids.add(item.id);
  }
  if (cases.length !== 20) throw new Error("Recall baseline requires exactly 20 cases; received " + cases.length);

  const db = openDatabase(":memory:");
  try {
    migrate(db);
    const project = createProject(db, {name: "Mira recall baseline", rootPath: "/mira-recall-baseline"});
    const authority = authorizeCuration(db, project.id, {actor: "benchmark", reason: "Synthetic recall baseline fixture"});
    const keyByMemoryId = new Map<string, string>();
    for (const item of cases) {
      const memory = curateMemory(db, {operation: "add", input: {
        projectId: project.id,
        title: item.memory.title,
        kind: item.memory.kind,
        content: item.memory.content,
        source: "benchmark",
        confidence: 1,
        importance: 5
      }}, authority);
      keyByMemoryId.set(memory.id, item.id);
    }

    const results = cases.map((item): RecallBaselineResult => {
      const returnedMemoryKeys = searchMemories(db, project.id, item.question, {limit: 5})
        .map(result => keyByMemoryId.get(result.memory.id))
        .filter((key): key is string => Boolean(key));
      const index = returnedMemoryKeys.indexOf(item.id);
      return {
        id: item.id,
        question: item.question,
        expectedMemoryKey: item.id,
        rank: index === -1 ? null : index + 1,
        returnedMemoryKeys
      };
    });
    const total = results.length;
    return {
      schemaVersion: 1,
      total,
      recallAt1: results.filter(item => item.rank === 1).length / total,
      recallAt5: results.filter(item => item.rank !== null && item.rank <= 5).length / total,
      meanReciprocalRank: results.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / total,
      cases: results
    };
  } finally {
    db.close();
  }
}
