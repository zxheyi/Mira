import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runRecallBaseline, type RecallBaselineCase } from "../../src/evaluation/recallBaseline.js";

const cases = JSON.parse(readFileSync(new URL("../../specs/026-recall-quality-baseline/cases.json", import.meta.url), "utf8")) as RecallBaselineCase[];

describe("recall quality baseline", () => {
  test("scores the 20-case corpus through the public memory search seam", () => {
    const report = runRecallBaseline(cases);
    const repeated = runRecallBaseline(cases);

    expect(report.total).toBe(20);
    expect(repeated).toEqual(report);
    expect(report.cases).toHaveLength(20);
    expect(report.recallAt1).toBe(report.cases.filter(item => item.rank === 1).length / 20);
    expect(report.recallAt5).toBe(report.cases.filter(item => item.rank !== null && item.rank <= 5).length / 20);
    expect(report.meanReciprocalRank).toBeCloseTo(
      report.cases.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / 20
    );
  });

  test("rejects duplicate case identifiers", () => {
    expect(() => runRecallBaseline([cases[0], cases[0]])).toThrow(/duplicate case id/i);
  });
});
