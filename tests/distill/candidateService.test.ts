import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  listMemoryCandidates,
  reviewMemoryCandidate,
  submitMemoryCandidates
} from "../../src/distill/candidateService.js";
import { addMemory, listMemoriesForProject } from "../../src/memory/memoryStore.js";
import { archiveMemory } from "../../src/memory/memoryLifecycleStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/mira-candidates" });
  const rawText = [
    "## Summary",
    "Mira stores durable project memory in local SQLite.",
    "We decided that architecture changes require human review.",
    "Use numbered migrations for every schema change.",
    "The replacement storage is a remote database."
  ].join("\n");
  const thread = saveThread(db, {
    id: "thread_candidates",
    projectId: project.id,
    title: "Candidate session",
    source: "codex",
    rawFormat: "markdown",
    rawText
  });
  return { database: db, project, thread };
}

describe("trusted memory candidate service", () => {
  test("high self-reported confidence does not approve a claim absent from the evidence", () => {
    const { database, project, thread } = setup();
    const [result] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: thread.id, sourceAgent: "provider", extractionMethod: "provider",
      candidates: [{title: "Unsupported conclusion", kind: "fact", content: "Mira guarantees profitable investment returns.",
        evidence: "Mira stores durable project memory in local SQLite.", confidence: 1, importance: 0.9}]
    });
    expect(result.outcome).toBe("pending_review");
    expect(result.reasons).toContain("non_verbatim_claim");
    expect(listMemoriesForProject(database, project.id)).toEqual([]);
  });
  test("auto-accepts high-confidence low-risk candidates with exact evidence", () => {
    const { database, project, thread } = setup();

    const [result] = submitMemoryCandidates(database, {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "codex",
      sourceModel: "gpt-5",
      extractionMethod: "agent",
      candidates: [{
        title: "Local storage",
        kind: "fact",
        content: "Mira stores durable project memory in local SQLite.",
        evidence: "Mira stores durable project memory in local SQLite.",
        confidence: 0.98,
        importance: 0.8
      }]
    });

    expect(result.outcome).toBe("accepted");
    expect(result.memory).toMatchObject({
      title: "Local storage",
      source: `candidate:${result.candidate.id}`,
      importance: 8
    });
    expect(result.candidate.acceptedMemoryId).toBe(result.memory?.id);
  });

  test("queues high-impact, low-confidence, and conflicting candidates for review", () => {
    const { database, project, thread } = setup();
    addMemory(database, {
      projectId: project.id,
      threadId: thread.id,
      title: "Storage",
      kind: "fact",
      content: "The existing storage is local SQLite.",
      source: "manual",
      confidence: 1,
      importance: 8
    });

    const results = submitMemoryCandidates(database, {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "provider",
      extractionMethod: "provider",
      candidates: [
        {
          title: "Architecture review",
          kind: "architecture",
          content: "Architecture changes require human review.",
          evidence: "We decided that architecture changes require human review.",
          confidence: 0.99,
          importance: 0.9
        },
        {
          title: "Migration rule",
          kind: "convention",
          content: "Use numbered migrations for every schema change.",
          evidence: "Use numbered migrations for every schema change.",
          confidence: 0.7,
          importance: 0.7
        },
        {
          title: "Storage",
          kind: "fact",
          content: "The replacement storage is a remote database.",
          evidence: "The replacement storage is a remote database.",
          confidence: 0.99,
          importance: 0.9
        }
      ]
    });

    expect(results.map((result) => result.outcome)).toEqual([
      "pending_review",
      "pending_review",
      "pending_review"
    ]);
    expect(results[0]?.reasons).toContain("high_impact_kind");
    expect(results[1]?.reasons).toContain("low_confidence");
    expect(results[2]?.reasons).toContain("conflict");
  });

  test("rejects missing evidence and sensitive text before persistence", () => {
    const { database, project, thread } = setup();
    const base = {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "codex",
      extractionMethod: "agent" as const
    };

    expect(() => submitMemoryCandidates(database, {
      ...base,
      candidates: [{
        title: "Unsupported inference",
        kind: "fact",
        content: "Not present in transcript.",
        evidence: "This excerpt does not exist.",
        confidence: 0.99,
        importance: 0.5
      }]
    })).toThrow("evidence");

    expect(() => submitMemoryCandidates(database, {
      ...base,
      candidates: [{
        title: "Credential",
        kind: "fact",
        content: "token=ghp_123456789012345678901234567890123456",
        evidence: "Mira stores durable project memory in local SQLite.",
        confidence: 0.99,
        importance: 0.5
      }]
    })).toThrow("sensitive");

    expect(() => submitMemoryCandidates(database, {
      ...base,
      candidates: [{
        title: "OpenAI credential",
        kind: "fact",
        content: "The key is sk-proj-123456789012345678901234567890.",
        evidence: "Mira stores durable project memory in local SQLite.",
        confidence: 0.99,
        importance: 0.5
      }]
    })).toThrow("sensitive");

    expect(listMemoryCandidates(database, project.id)).toEqual([]);
  });

  test("deduplicates submissions and reviews pending candidates idempotently", () => {
    const { database, project, thread } = setup();
    const input = {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "codex",
      extractionMethod: "agent" as const,
      candidates: [{
        title: "Architecture review",
        kind: "architecture" as const,
        content: "Architecture changes require human review.",
        evidence: "We decided that architecture changes require human review.",
        confidence: 0.99,
        importance: 0.9
      }]
    };

    const [first] = submitMemoryCandidates(database, input);
    const [duplicate] = submitMemoryCandidates(database, input);
    expect(duplicate.outcome).toBe("duplicate");
    expect(duplicate.candidate.id).toBe(first.candidate.id);

    const accepted = reviewMemoryCandidate(database, project.id, first.candidate.id, "accept", "Confirmed");
    const acceptedAgain = reviewMemoryCandidate(database, project.id, first.candidate.id, "accept", "Confirmed again");
    expect(acceptedAgain.memory?.id).toBe(accepted.memory?.id);
    expect(() => reviewMemoryCandidate(database, project.id, first.candidate.id, "reject", "Changed mind"))
      .toThrow("already accepted");
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("links a duplicate candidate to an existing memory without rewriting provenance", () => {
    const { database, project, thread } = setup();
    const existing = addMemory(database, {
      projectId: project.id,
      threadId: thread.id,
      title: "Local storage",
      kind: "fact",
      content: "Mira stores durable project memory in local SQLite.",
      source: "manual",
      confidence: 1,
      importance: 8
    });

    const [result] = submitMemoryCandidates(database, {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "codex",
      extractionMethod: "agent",
      candidates: [{
        title: "Local storage",
        kind: "fact",
        content: "Mira stores durable project memory in local SQLite.",
        evidence: "Mira stores durable project memory in local SQLite.",
        confidence: 0.99,
        importance: 0
      }]
    });

    expect(result).toMatchObject({
      outcome: "duplicate",
      candidate: { status: "accepted", acceptedMemoryId: existing.id },
      memory: { id: existing.id, source: "manual", status: "active", updatedAt: expect.any(String) }
    });
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("deduplicates durable memory across threads in the same project", () => {
    const { database, project, thread } = setup();
    const existing = addMemory(database, {
      projectId: project.id,
      threadId: thread.id,
      title: "Local storage", kind: "fact",
      content: "Mira stores durable project memory in local SQLite.",
      source: "manual", confidence: 1, importance: 8
    });
    saveThread(database, {
      id: "thread_second", projectId: project.id, title: "Second", source: "claude-code",
      rawFormat: "markdown", rawText: "Mira stores durable project memory in local SQLite."
    });

    const [result] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: "thread_second", sourceAgent: "claude-code",
      extractionMethod: "agent",
      candidates: [{
        title: "Local storage", kind: "fact",
        content: "Mira stores durable project memory in local SQLite.",
        evidence: "Mira stores durable project memory in local SQLite.",
        confidence: 0.99, importance: 0.8
      }]
    });

    expect(result).toMatchObject({ outcome: "duplicate", memory: { id: existing.id } });
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("refuses to accept a pending candidate after its source Thread changes", () => {
    const { database, project, thread } = setup();
    const [pending] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: thread.id, sourceAgent: "codex", extractionMethod: "agent",
      candidates: [{
        title: "Architecture review", kind: "architecture",
        content: "Architecture changes require human review.",
        evidence: "We decided that architecture changes require human review.",
        confidence: 0.99, importance: 0.9
      }]
    });
    saveThread(database, {
      id: thread.id, projectId: project.id, title: thread.title, source: thread.source,
      rawFormat: thread.rawFormat, rawText: "The original evidence has been removed."
    });

    expect(() => reviewMemoryCandidate(database, project.id, pending.candidate.id, "accept", "Confirmed"))
      .toThrow(/source Thread has changed/);
    expect(listMemoriesForProject(database, project.id)).toEqual([]);

    saveThread(database, {
      id: thread.id, projectId: project.id, title: thread.title, source: thread.source,
      rawFormat: thread.rawFormat, rawText: `${thread.rawText}\nThe session was updated.`
    });
    const [resubmitted] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: thread.id, sourceAgent: "codex", extractionMethod: "agent",
      candidates: [{
        title: "Architecture review", kind: "architecture",
        content: "Architecture changes require human review.",
        evidence: "We decided that architecture changes require human review.",
        confidence: 0.99, importance: 0.9
      }]
    });
    expect(resubmitted.candidate.id).not.toBe(pending.candidate.id);
    expect(reviewMemoryCandidate(database, project.id, resubmitted.candidate.id, "accept").outcome).toBe("accepted");
  });

  test("accepts a conflict candidate as the explicit successor of an active Memory", () => {
    const { database, project, thread } = setup();
    const predecessor = addMemory(database, {
      projectId: project.id,
      title: "Storage",
      kind: "fact",
      content: "The existing storage is local SQLite.",
      source: "manual",
      confidence: 1,
      importance: 8
    });
    const [pending] = submitMemoryCandidates(database, {
      projectId: project.id,
      threadId: thread.id,
      sourceAgent: "codex",
      extractionMethod: "agent",
      candidates: [{
        title: "Storage",
        kind: "fact",
        content: "The replacement storage is a remote database.",
        evidence: "The replacement storage is a remote database.",
        confidence: 0.99,
        importance: 0.9
      }]
    });

    const reviewed = reviewMemoryCandidate(
      database, project.id, pending.candidate.id, "accept", "Approved replacement", predecessor.id
    );

    expect(reviewed).toMatchObject({
      outcome: "accepted",
      memory: { supersedesMemoryId: predecessor.id, status: "active" },
      candidate: { acceptedMemoryId: reviewed.memory?.id }
    });
    expect(database.prepare("select status from memories where id = ?").pluck().get(predecessor.id)).toBe("superseded");
    expect(reviewed.memory?.threadId).toBeUndefined();
  });

  test("restores an archived duplicate candidate instead of linking inactive Memory", () => {
    const { database, project, thread } = setup();
    const archived = addMemory(database, {
      projectId: project.id, threadId: thread.id, title: "Local storage", kind: "fact",
      content: "Mira stores durable project memory in local SQLite.", source: "manual", confidence: 1, importance: 8
    });
    archiveMemory(database, project.id, archived.id, "cli", "Temporarily stale");

    const [result] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: thread.id, sourceAgent: "codex", extractionMethod: "agent",
      candidates: [{
        title: "Local storage", kind: "fact", content: archived.content, evidence: archived.content,
        confidence: 0.99, importance: 0.8
      }]
    });

    expect(result).toMatchObject({ outcome: "accepted", memory: { id: archived.id, status: "active" } });
  });

  test("rejects supersedes when rejecting a candidate", () => {
    const { database, project, thread } = setup();
    const [pending] = submitMemoryCandidates(database, {
      projectId: project.id, threadId: thread.id, sourceAgent: "codex", extractionMethod: "agent",
      candidates: [{
        title: "Architecture review", kind: "architecture",
        content: "Architecture changes require human review.",
        evidence: "We decided that architecture changes require human review.", confidence: 0.99, importance: 0.9
      }]
    });

    expect(() => reviewMemoryCandidate(
      database, project.id, pending.candidate.id, "reject", "Not accepted", "memory_unused"
    )).toThrow(/supersedes is only valid when accepting/);
  });
});
