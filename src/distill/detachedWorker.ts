import { spawn } from "node:child_process";

export type DetachedDistillWorkerOptions = {
  nodePath: string;
  entryPath: string;
  dbPath: string;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
};

export async function startDetachedDistillWorker(options: DetachedDistillWorkerOptions): Promise<void> {
  const child = spawn(options.nodePath, [
    options.entryPath,
    "--db", options.dbPath,
    "--project-root", options.projectRoot,
    "distill", "jobs", "run", "--once"
  ], {
    detached: true,
    stdio: "ignore",
    env: options.env
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
