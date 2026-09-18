import {openDatabase} from "../db/client.js";
import {migrate} from "../db/schema.js";
import {startDetachedDistillWorker, type DetachedDistillWorkerOptions} from "../distill/detachedWorker.js";
import {providerConfigFromEnv} from "../distill/openAiCompatibleProvider.js";
import {createDefaultOutboxHandlers, drainOutbox} from "../events/defaultOutboxHandlers.js";
import {createOutboxRunner} from "../events/outboxRunner.js";
import {ensureProjectForRoot} from "../projects/projectStore.js";

export type HookFollowUpOptions = DetachedDistillWorkerOptions & {
  startWorker?: typeof startDetachedDistillWorker;
};

/** Finish local follow-up first. A model job stays pending until a configured worker runs it. */
export async function runHookFollowUp(options: HookFollowUpOptions): Promise<{
  outbox: Awaited<ReturnType<typeof drainOutbox>>;
  worker: "not_configured" | "launched";
}> {
  const db = openDatabase(options.dbPath);
  let outbox: Awaited<ReturnType<typeof drainOutbox>>;
  try {
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    outbox = await drainOutbox(createOutboxRunner({db}), project.id, createDefaultOutboxHandlers({db}));
  } finally {
    db.close();
  }

  if (!providerConfigFromEnv(options.env)) return {outbox, worker: "not_configured"};
  // Launching a worker is not evidence that extraction or Memory acceptance has
  // completed. Launch errors are left for the Hook's diagnostic-only boundary.
  await (options.startWorker ?? startDetachedDistillWorker)({
    nodePath: options.nodePath,
    entryPath: options.entryPath,
    projectRoot: options.projectRoot,
    dbPath: options.dbPath,
    env: options.env
  });
  return {outbox, worker: "launched"};
}
