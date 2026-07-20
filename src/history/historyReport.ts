import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { HistoryImportReport } from "./historyTypes.js";

export async function writeHistoryImportReport(
  report: HistoryImportReport,
  outputPath: string
): Promise<string> {
  const target = resolve(outputPath);
  const directory = dirname(target);
  const temporary = `${target}.tmp-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
