import type Database from "better-sqlite3";
import { prepareContext, type PrepareContextOptions } from "./contextPreparation.js";

export type BuildContextBundleOptions = PrepareContextOptions;

/** Compatibility interface for existing Markdown consumers. */
export function buildContextBundle(db: Database.Database, projectId: string, options: BuildContextBundleOptions = {}): string {
  return prepareContext(db, projectId, options).markdown;
}
