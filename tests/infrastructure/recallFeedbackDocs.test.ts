import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

const read = (path:string) => readFile(join(process.cwd(), path), "utf8");

test("README and investment Skill require explicit user labels before retrieval decisions", async () => {
  const [readme, skill, profile] = await Promise.all([
    read("README.md"),
    read("skills/mira-investment-research/SKILL.md"),
    read("skills/mira-investment-research/references/runtime-profile.yaml")
  ]);
  for (const content of [readme, skill]) {
    expect(content).toContain("record_recall_feedback");
    expect(content).toContain("get_recall_quality_report");
  }
  expect(skill).toContain("不能根据工具调用成功");
  expect(skill).toContain("recallId");
  expect(profile).toContain('generic_recall_feedback: "record_recall_feedback"');
  expect(profile).toContain('retrieval_quality_report: "get_recall_quality_report"');
  expect(profile).toContain("minimum_labeled_recalls: 20");
  expect(profile).toContain("minimum_retrieval_miss_records: 5");
  expect(profile).toContain('automatic_feedback: "disabled"');
});
