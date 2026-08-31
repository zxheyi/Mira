import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { createMiraMcpServer } from "./server.js";
import type { ConfirmationPolicy } from "../memory/curationService.js";

export type ServeMcpOptions = {
  confirmationPolicy?: ConfirmationPolicy;
  projectRoot: string;
  dbPath: string;
  taskId?: string;
};

export async function serveMiraMcpStdio(options: ServeMcpOptions): Promise<void> {
  const { server } = createMiraMcpServer({
    projectRoot: resolve(options.projectRoot),
    dbPath: resolve(options.dbPath),
    taskId: options.taskId,
    confirmationPolicy: options.confirmationPolicy
  });
  await server.connect(new StdioServerTransport());
}
