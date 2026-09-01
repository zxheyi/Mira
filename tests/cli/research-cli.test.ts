import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runMira(args: string[], projectRoot: string, dbPath: string) {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" }
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

test("research CLI submits, reviews, reads and exports through one domain service", async () => {
  const root = await mkdtemp(join(tmpdir(), "mira-research-cli-"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  const packetPath = join(root, "packet.json");
  const exportPath = join(root, "research.md");
  await writeFile(packetPath, JSON.stringify({
    case: { title: "Public company", question: "What changed?", asOfDate: "2026-09-01" },
    evidence: [{
      key: "E1", sourceType: "regulatory_filing",
      sourceUri: "https://example.test/filing", sourceTitle: "Filing", locator: "p. 1",
      excerpt: "Revenue increased.", accessedAt: "2026-09-01"
    }],
    claims: [{
      key: "C1", statement: "Revenue increased.", evidenceStatus: "supported", confidence: 0.8,
      thesisImpact: "watch", invalidationConditions: "A later filing reports a decline.",
      links: [{ evidenceKey: "E1", relation: "supports", rationale: "Direct observation." }]
    }]
  }));

  const submitted = parseJson<{
    researchCase: { id: string; status: string };
    claims: Array<{ id: string; reviewStatus: string }>;
  }>((await runMira(["research", "submit", "--path", packetPath], root, dbPath)).stdout);
  expect(submitted.researchCase.status).toBe("draft");

  const reviewed = parseJson<{ researchCase: { status: string }; claims: Array<{ reviewStatus: string }> }>(
    (await runMira([
      "research", "review", "--claim", submitted.claims[0].id,
      "--decision", "approve", "--reason", "Checked primary source."
    ], root, dbPath)).stdout
  );
  expect(reviewed).toMatchObject({
    researchCase: { status: "completed" },
    claims: [expect.objectContaining({ reviewStatus: "approved" })]
  });

  const shown = parseJson<{ researchCase: { id: string }; events: unknown[] }>(
    (await runMira(["research", "show", "--case", submitted.researchCase.id], root, dbPath)).stdout
  );
  expect(shown.researchCase.id).toBe(submitted.researchCase.id);
  expect(shown.events).toHaveLength(2);

  const exported = parseJson<{ caseId: string; path: string }>(
    (await runMira([
      "research", "export", "--case", submitted.researchCase.id, "--out", exportPath
    ], root, dbPath)).stdout
  );
  expect(exported).toEqual({ caseId: submitted.researchCase.id, path: exportPath });
  const markdown = await readFile(exportPath, "utf8");
  expect(markdown).toContain("# Research Case: Public company");
  expect(markdown).toContain("## Evidence Ledger");
  expect(markdown).toContain("## Claim Matrix");
  expect(markdown).toContain("Mira does not mutate thesis state");
}, 30_000);
