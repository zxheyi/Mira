import type { IntegrationAgent } from "./configInstaller.js";

function sessionSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "session";
}

export function stableThreadId(agent: IntegrationAgent, sessionId: string): string {
  return `thread_${sessionSlug(agent)}_${sessionSlug(sessionId)}`;
}
