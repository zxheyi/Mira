import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "vitest";

async function callJson<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  const blocks = result.content as Array<{type: string; text?: string}>;
  const text = blocks.find((item) => item.type === "text")?.text;
  expect(text).toBeTypeOf("string");
  return JSON.parse(text as string) as T;
}

describe("Mira MCP stdio research lifecycle", () => {
  test("a connected client sees only approved verified research and loses it after stale propagation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mira-mcp-stdio-research-"));
    const dbPath = join(projectRoot, ".mira", "mira.sqlite");
    const client = new Client(
      { name: "codex-research-acceptance", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(process.cwd(), "dist", "src", "index.js"),
        "mcp",
        "serve",
        "--project-root",
        projectRoot,
        "--db",
        dbPath,
        "--confirmation-policy",
        "Real stdio research lifecycle acceptance"
      ],
      cwd: process.cwd(),
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("prepare_research_context");

      const submitted = await callJson<{
        researchCase: {id: string};
        evidence: Array<{id: string}>;
        claims: Array<{id: string}>;
      }>(client, "submit_research_packet", {
        case: {
          title: "Stdio filing review",
          question: "Did reported revenue increase?",
          asOfDate: "2026-09-01"
        },
        snapshots: [{
          key: "S1",
          canonicalUri: "https://example.test/stdio-filing",
          sourceTitle: "Stdio filing",
          publishedAt: "2026-08-01",
          accessedAt: "2026-09-01",
          mediaType: "text/plain",
          content: "Page 7\nReported revenue increased by 10%."
        }],
        evidence: [{
          key: "E1",
          snapshotKey: "S1",
          sourceType: "regulatory_filing",
          sourceUri: "https://example.test/stdio-filing",
          sourceTitle: "Stdio filing",
          locator: "Page 7",
          excerpt: "Reported revenue increased by 10%.",
          publishedAt: "2026-08-01",
          accessedAt: "2026-09-01"
        }],
        claims: [{
          key: "C1",
          statement: "Reported revenue growth was positive.",
          evidenceStatus: "supported",
          confidence: 0.9,
          thesisImpact: "watch",
          invalidationConditions: "A later filing restates revenue.",
          links: [{
            evidenceKey: "E1",
            relation: "supports",
            rationale: "Direct reported observation."
          }]
        }]
      });

      expect(await callJson(client, "prepare_research_context", {
        caseId: submitted.researchCase.id
      })).toMatchObject({ claimIds: [], evidenceIds: [], snapshotIds: [] });

      await callJson(client, "verify_research_evidence", {
        caseId: submitted.researchCase.id,
        evidenceId: submitted.evidence[0].id
      });
      await callJson(client, "review_research_claim", {
        claimId: submitted.claims[0].id,
        decision: "approve",
        reason: "Verified against the Source Snapshot."
      });

      expect(await callJson(client, "prepare_research_context", {
        caseId: submitted.researchCase.id
      })).toMatchObject({
        claimIds: [submitted.claims[0].id],
        evidenceIds: [submitted.evidence[0].id],
        markdown: expect.stringContaining("Reported revenue growth was positive.")
      });

      await callJson(client, "mark_research_evidence_stale", {
        evidenceId: submitted.evidence[0].id,
        reason: "Superseded by a later filing."
      });
      expect(await callJson(client, "prepare_research_context", {
        caseId: submitted.researchCase.id
      })).toMatchObject({ claimIds: [], evidenceIds: [], snapshotIds: [] });
    } finally {
      await client.close();
    }
  }, 20_000);
});
