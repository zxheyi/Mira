import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

async function readProjectFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

describe("documentation readiness", () => {
  test("README includes first-run setup, destructive commands, and global option placement", async () => {
    const readme = await readProjectFile("README.md");

    expect(readme).toContain("npm install");
    expect(readme).toContain("npm run build");
    expect(readme).toContain("mira thread delete");
    expect(readme).toContain("mira project delete");
    expect(readme).toContain("mira memory clear");
    expect(readme).toContain("mira working clear");
    expect(readme).toContain("全局选项需要放在子命令前");
    expect(readme).toContain("`--raw-format` 是 `--format` 的别名");
  });

  test("agent templates describe required MCP arguments and failed attempt kind guidance", async () => {
    const agents = await readProjectFile("docs/agent-config/AGENTS-template.md");
    const claude = await readProjectFile("docs/agent-config/CLAUDE-template.md");

    for (const content of [agents, claude]) {
      expect(content).toContain("add_memory");
      expect(content).toContain("source");
      expect(content).toContain("save_thread");
      expect(content).toContain("rawFormat");
      expect(content).toContain("rawText");
      expect(content).toContain("failed_attempt");
    }
    expect(agents).not.toContain("失败尝试要记录为 `lesson` 或 `constraint`");
  });

  test("investment research skill recalls project and evidence-gated case context", async () => {
    const skill = await readProjectFile("skills/mira-investment-research/SKILL.md");
    const profile = await readProjectFile("skills/mira-investment-research/references/runtime-profile.yaml");

    expect(skill).toContain("prepare_context");
    expect(skill).toContain("prepare_research_context");
    expect(skill).toContain("list_research_cases");
    expect(skill).toContain("list_research_context_recalls");
    expect(skill).toContain("claimIds");
    expect(skill).toContain("evidenceIds");
    expect(skill).toContain("snapshotIds");
    expect(profile).toContain('project_context: "prepare_context"');
    expect(profile).toContain('case_discovery: "list_research_cases"');
    expect(profile).toContain('case_context: "prepare_research_context"');
    expect(profile).toContain('research_context_provenance: "required"');
    expect(profile).toContain('research_context_receipts: "list_research_context_recalls"');
  });
});
