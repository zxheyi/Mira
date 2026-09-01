import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertRecallBaselineThresholds, runRecallBaseline } from "../dist/src/evaluation/recallBaseline.js";

const defaultCases = fileURLToPath(new URL("../specs/026-recall-quality-baseline/cases.json", import.meta.url));
const casesPath = process.argv[2] ?? defaultCases;
const cases = JSON.parse(await readFile(casesPath, "utf8"));
const report = runRecallBaseline(cases);
assertRecallBaselineThresholds(report);
console.log(JSON.stringify(report, null, 2));
