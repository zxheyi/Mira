import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { createMiraMcpServer } from "./server.js";

export type ServeMcpOptions = {
  projectRoot: string;
  dbPath: string;
};

export async function serveMiraMcpStdio(options: ServeMcpOptions): Promise<void> {
  const { server } = createMiraMcpServer({
    projectRoot: resolve(options.projectRoot),
    dbPath: resolve(options.dbPath)
  });
  await server.connect(new StdioServerTransport());
}
