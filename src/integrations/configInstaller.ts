import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type IntegrationAgent = "codex" | "claude-code";
export type IntegrationAgentTarget = IntegrationAgent | "all";

export type IntegrationRuntime = {
  nodePath: string;
  entryPath: string;
};

export type IntegrationChange = {
  path: string;
  action: "created" | "updated" | "unchanged";
};

export type IntegrationResult = {
  agent: IntegrationAgentTarget;
  projectRoot: string;
  dryRun: boolean;
  changes: IntegrationChange[];
};

type InstallOptions = {
  agent: IntegrationAgentTarget;
  projectRoot: string;
  dbPath: string;
  runtime: IntegrationRuntime;
  dryRun?: boolean;
};

type UninstallOptions = {
  agent: IntegrationAgentTarget;
  projectRoot: string;
  runtime?: IntegrationRuntime;
  dryRun?: boolean;
};

type JsonObject = Record<string, unknown>;

const MANAGED_ARGUMENT = "--managed-by mira";
const CODEX_BLOCK_START = "# >>> mira managed";
const CODEX_BLOCK_END = "# <<< mira managed";
const LOCAL_EXCLUDE_BLOCK_START = "# >>> mira integration local config";
const LOCAL_EXCLUDE_BLOCK_END = "# <<< mira integration local config";
const CODEX_LOCAL_PATHS = [".codex/hooks.json", ".codex/config.toml"] as const;
const CLAUDE_LOCAL_PATHS = [".claude/settings.local.json", ".mcp.json"] as const;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseJsonObject(path: string, text: string | undefined): JsonObject {
  if (text === undefined || !text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("root value must be an object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot update integration config ${path}: invalid JSON (${message})`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.mira-${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

async function updateTextFile(
  path: string,
  nextContent: string,
  dryRun: boolean
): Promise<IntegrationChange> {
  const current = await readOptional(path);
  const action = current === undefined ? "created" : current === nextContent ? "unchanged" : "updated";

  if (!dryRun && action !== "unchanged") {
    await atomicWrite(path, nextContent);
  }

  return { path, action };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hookCommand(
  agent: IntegrationAgent,
  projectRoot: string,
  dbPath: string,
  runtime: IntegrationRuntime
): string {
  return [
    shellQuote(runtime.nodePath),
    shellQuote(runtime.entryPath),
    "--project-root",
    shellQuote(projectRoot),
    "--db",
    shellQuote(dbPath),
    "integration",
    "hook",
    "--agent",
    agent,
    MANAGED_ARGUMENT
  ].join(" ");
}

function mcpConfig(projectRoot: string, dbPath: string, runtime: IntegrationRuntime): JsonObject {
  return {
    type: "stdio",
    command: runtime.nodePath,
    args: [
      runtime.entryPath,
      "--project-root",
      projectRoot,
      "--db",
      dbPath,
      "mcp",
      "serve"
    ],
    env: {
      MIRA_MANAGED_BY: "mira"
    }
  };
}

function isMiraHookGroup(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return false;
  }

  return value.hooks.some(
    (hook) => isRecord(hook) && typeof hook.command === "string" && hook.command.includes(MANAGED_ARGUMENT)
  );
}

function hookGroup(command: string, event: "SessionStart" | "Stop" | "SessionEnd"): JsonObject {
  const group: JsonObject = {
    hooks: [
      {
        type: "command",
        command,
        timeout: event === "SessionStart" ? 10 : 30,
        statusMessage: event === "SessionStart" ? "Loading Mira context" : "Saving Mira session"
      }
    ]
  };

  if (event === "SessionStart") {
    group.matcher = "startup|resume|clear|compact";
  }

  return group;
}

function mergeHook(
  hooks: JsonObject,
  event: "SessionStart" | "Stop" | "SessionEnd",
  command: string
): void {
  const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
  hooks[event] = [...existing.filter((entry) => !isMiraHookGroup(entry)), hookGroup(command, event)];
}

function removeMiraHooks(root: JsonObject): void {
  if (!isRecord(root.hooks)) {
    return;
  }

  for (const event of ["SessionStart", "Stop", "SessionEnd"] as const) {
    if (!Array.isArray(root.hooks[event])) {
      continue;
    }
    root.hooks[event] = root.hooks[event].filter((entry) => !isMiraHookGroup(entry));
  }
}

function hasMiraHooks(root: JsonObject, events: readonly string[]): boolean {
  if (!isRecord(root.hooks)) {
    return false;
  }
  const hooks = root.hooks;
  return events.every(
    (event) => Array.isArray(hooks[event]) && (hooks[event] as unknown[]).some(isMiraHookGroup)
  );
}

function serializeJson(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function managedCodexBlock(projectRoot: string, dbPath: string, runtime: IntegrationRuntime): string {
  const args = [
    runtime.entryPath,
    "--project-root",
    projectRoot,
    "--db",
    dbPath,
    "mcp",
    "serve"
  ];

  return [
    CODEX_BLOCK_START,
    "[mcp_servers.mira]",
    `command = ${tomlString(runtime.nodePath)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
    "enabled = true",
    CODEX_BLOCK_END
  ].join("\n");
}

function assertClaudeMcpAvailable(servers: JsonObject): void {
  if (
    servers.mira !== undefined &&
    (!isRecord(servers.mira) || !isRecord(servers.mira.env) || servers.mira.env.MIRA_MANAGED_BY !== "mira")
  ) {
    throw new Error("Cannot install Mira: existing unmanaged Claude Code MCP server named mira");
  }
}

function managedBlockRange(content: string): { start: number; end: number } | undefined {
  const start = content.indexOf(CODEX_BLOCK_START);
  if (start < 0) {
    return undefined;
  }
  const blockEnd = content.indexOf(CODEX_BLOCK_END, start);
  if (blockEnd < 0) {
    throw new Error("Cannot update Codex config: Mira managed block is missing its end marker");
  }
  return { start, end: blockEnd + CODEX_BLOCK_END.length };
}

function upsertCodexBlock(current: string | undefined, block: string): string {
  const content = current ?? "";
  const range = managedBlockRange(content);
  if (range) {
    return `${content.slice(0, range.start)}${block}${content.slice(range.end)}`;
  }
  if (/^\s*\[mcp_servers\.mira\]\s*$/m.test(content)) {
    throw new Error("Cannot install Mira: existing unmanaged Codex MCP server named mira");
  }
  const prefix = content.length > 0 && !content.endsWith("\n") ? `${content}\n` : content;
  return `${prefix}${prefix.length > 0 ? "\n" : ""}${block}\n`;
}

function removeCodexBlock(current: string | undefined): string {
  if (current === undefined) {
    return "";
  }
  const range = managedBlockRange(current);
  if (!range) {
    return current;
  }
  const before = current.slice(0, range.start).replace(/\n{2,}$/, "\n");
  const after = current.slice(range.end).replace(/^\n{2,}/, "\n");
  return `${before}${after}`;
}

function integrationLocalPaths(agent: IntegrationAgentTarget): string[] {
  if (agent === "codex") {
    return [...CODEX_LOCAL_PATHS];
  }
  if (agent === "claude-code") {
    return [...CLAUDE_LOCAL_PATHS];
  }
  return [...CODEX_LOCAL_PATHS, ...CLAUDE_LOCAL_PATHS];
}

async function gitExcludePath(projectRoot: string): Promise<string | undefined> {
  const dotGitPath = join(projectRoot, ".git");
  let dotGitStat;
  try {
    dotGitStat = await stat(dotGitPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  if (dotGitStat.isDirectory()) {
    return join(dotGitPath, "info", "exclude");
  }

  const pointer = (await readFile(dotGitPath, "utf8")).trim().match(/^gitdir:\s*(.+)$/i)?.[1];
  if (!pointer) {
    return undefined;
  }
  const gitDir = resolve(dirname(dotGitPath), pointer);
  const commonDirText = await readOptional(join(gitDir, "commondir"));
  const commonDir = commonDirText ? resolve(gitDir, commonDirText.trim()) : gitDir;
  return join(commonDir, "info", "exclude");
}

function localExcludeRange(content: string): { start: number; end: number } | undefined {
  const start = content.indexOf(LOCAL_EXCLUDE_BLOCK_START);
  if (start < 0) {
    return undefined;
  }
  const blockEnd = content.indexOf(LOCAL_EXCLUDE_BLOCK_END, start);
  if (blockEnd < 0) {
    throw new Error("Cannot update Git exclude: Mira managed block is missing its end marker");
  }
  return { start, end: blockEnd + LOCAL_EXCLUDE_BLOCK_END.length };
}

function readLocalExcludePaths(content: string): Set<string> {
  const range = localExcludeRange(content);
  if (!range) {
    return new Set();
  }
  return new Set(
    content
      .slice(range.start + LOCAL_EXCLUDE_BLOCK_START.length, range.end - LOCAL_EXCLUDE_BLOCK_END.length)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
}

function replaceLocalExcludeBlock(content: string, paths: Set<string>): string {
  const range = localExcludeRange(content);
  const withoutBlock = range
    ? `${content.slice(0, range.start)}${content.slice(range.end)}`
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n{2,}$/, "\n")
    : content;
  if (paths.size === 0) {
    return withoutBlock;
  }

  const prefix = withoutBlock.length > 0 && !withoutBlock.endsWith("\n")
    ? `${withoutBlock}\n`
    : withoutBlock;
  const block = [LOCAL_EXCLUDE_BLOCK_START, ...[...paths].sort(), LOCAL_EXCLUDE_BLOCK_END].join("\n");
  return `${prefix}${prefix.length > 0 ? "\n" : ""}${block}\n`;
}

async function updateGitExclude(
  projectRoot: string,
  agent: IntegrationAgentTarget,
  operation: "install" | "uninstall",
  dryRun: boolean
): Promise<IntegrationChange | undefined> {
  const excludePath = await gitExcludePath(projectRoot);
  if (!excludePath) {
    return undefined;
  }
  const current = (await readOptional(excludePath)) ?? "";
  const paths = readLocalExcludePaths(current);
  for (const path of integrationLocalPaths(agent)) {
    if (operation === "install") {
      paths.add(path);
    } else {
      paths.delete(path);
    }
  }
  return updateTextFile(excludePath, replaceLocalExcludeBlock(current, paths), dryRun);
}

async function installCodex(options: InstallOptions, root: string, dbPath: string): Promise<IntegrationChange[]> {
  const hooksPath = join(root, ".codex", "hooks.json");
  const configPath = join(root, ".codex", "config.toml");
  const hooksText = await readOptional(hooksPath);
  const hooksRoot = parseJsonObject(hooksPath, hooksText);
  const hooks = isRecord(hooksRoot.hooks) ? hooksRoot.hooks : {};
  hooksRoot.hooks = hooks;
  const command = hookCommand("codex", root, dbPath, options.runtime);
  mergeHook(hooks, "SessionStart", command);
  mergeHook(hooks, "Stop", command);

  const configText = await readOptional(configPath);
  const nextConfig = upsertCodexBlock(configText, managedCodexBlock(root, dbPath, options.runtime));

  return [
    await updateTextFile(hooksPath, serializeJson(hooksRoot), options.dryRun ?? false),
    await updateTextFile(configPath, nextConfig, options.dryRun ?? false)
  ];
}

async function preflightCodex(options: InstallOptions, root: string, dbPath: string): Promise<void> {
  const hooksPath = join(root, ".codex", "hooks.json");
  parseJsonObject(hooksPath, await readOptional(hooksPath));
  const configPath = join(root, ".codex", "config.toml");
  upsertCodexBlock(
    await readOptional(configPath),
    managedCodexBlock(root, dbPath, options.runtime)
  );
}

async function installClaudeCode(options: InstallOptions, root: string, dbPath: string): Promise<IntegrationChange[]> {
  const settingsPath = join(root, ".claude", "settings.local.json");
  const mcpPath = join(root, ".mcp.json");
  const settingsText = await readOptional(settingsPath);
  const settings = parseJsonObject(settingsPath, settingsText);
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  settings.hooks = hooks;
  const command = hookCommand("claude-code", root, dbPath, options.runtime);
  mergeHook(hooks, "SessionStart", command);
  mergeHook(hooks, "Stop", command);
  mergeHook(hooks, "SessionEnd", command);

  const mcpText = await readOptional(mcpPath);
  const mcp = parseJsonObject(mcpPath, mcpText);
  const servers = isRecord(mcp.mcpServers) ? mcp.mcpServers : {};
  mcp.mcpServers = servers;
  assertClaudeMcpAvailable(servers);
  servers.mira = mcpConfig(root, dbPath, options.runtime);

  return [
    await updateTextFile(settingsPath, serializeJson(settings), options.dryRun ?? false),
    await updateTextFile(mcpPath, serializeJson(mcp), options.dryRun ?? false)
  ];
}

async function preflightClaudeCode(root: string): Promise<void> {
  const settingsPath = join(root, ".claude", "settings.local.json");
  parseJsonObject(settingsPath, await readOptional(settingsPath));
  const mcpPath = join(root, ".mcp.json");
  const mcp = parseJsonObject(mcpPath, await readOptional(mcpPath));
  const servers = isRecord(mcp.mcpServers) ? mcp.mcpServers : {};
  assertClaudeMcpAvailable(servers);
}

export async function installAgentIntegration(options: InstallOptions): Promise<IntegrationResult> {
  const projectRoot = resolve(options.projectRoot);
  const dbPath = resolve(options.dbPath);
  const changes: IntegrationChange[] = [];

  await updateGitExclude(projectRoot, options.agent, "install", true);
  if (options.agent === "codex" || options.agent === "all") {
    await preflightCodex(options, projectRoot, dbPath);
  }
  if (options.agent === "claude-code" || options.agent === "all") {
    await preflightClaudeCode(projectRoot);
  }

  if (options.agent === "codex" || options.agent === "all") {
    changes.push(...(await installCodex(options, projectRoot, dbPath)));
  }
  if (options.agent === "claude-code" || options.agent === "all") {
    changes.push(...(await installClaudeCode(options, projectRoot, dbPath)));
  }
  const excludeChange = await updateGitExclude(
    projectRoot,
    options.agent,
    "install",
    options.dryRun ?? false
  );
  if (excludeChange) {
    changes.push(excludeChange);
  }

  return {
    agent: options.agent,
    projectRoot,
    dryRun: options.dryRun ?? false,
    changes
  };
}

async function uninstallCodex(options: UninstallOptions, root: string): Promise<IntegrationChange[]> {
  const hooksPath = join(root, ".codex", "hooks.json");
  const configPath = join(root, ".codex", "config.toml");
  const hooksText = await readOptional(hooksPath);
  const hooks = parseJsonObject(hooksPath, hooksText);
  removeMiraHooks(hooks);
  const configText = await readOptional(configPath);

  return [
    hooksText === undefined
      ? { path: hooksPath, action: "unchanged" }
      : await updateTextFile(hooksPath, serializeJson(hooks), options.dryRun ?? false),
    configText === undefined
      ? { path: configPath, action: "unchanged" }
      : await updateTextFile(configPath, removeCodexBlock(configText), options.dryRun ?? false)
  ];
}

async function uninstallClaudeCode(options: UninstallOptions, root: string): Promise<IntegrationChange[]> {
  const settingsPath = join(root, ".claude", "settings.local.json");
  const mcpPath = join(root, ".mcp.json");
  const settingsText = await readOptional(settingsPath);
  const settings = parseJsonObject(settingsPath, settingsText);
  removeMiraHooks(settings);
  const mcpText = await readOptional(mcpPath);
  const mcp = parseJsonObject(mcpPath, mcpText);
  if (isRecord(mcp.mcpServers) && isRecord(mcp.mcpServers.mira)) {
    const env = mcp.mcpServers.mira.env;
    if (isRecord(env) && env.MIRA_MANAGED_BY === "mira") {
      delete mcp.mcpServers.mira;
    }
  }

  return [
    settingsText === undefined
      ? { path: settingsPath, action: "unchanged" }
      : await updateTextFile(settingsPath, serializeJson(settings), options.dryRun ?? false),
    mcpText === undefined
      ? { path: mcpPath, action: "unchanged" }
      : await updateTextFile(mcpPath, serializeJson(mcp), options.dryRun ?? false)
  ];
}

export async function uninstallAgentIntegration(options: UninstallOptions): Promise<IntegrationResult> {
  const projectRoot = resolve(options.projectRoot);
  const changes: IntegrationChange[] = [];
  if (options.agent === "codex" || options.agent === "all") {
    changes.push(...(await uninstallCodex(options, projectRoot)));
  }
  if (options.agent === "claude-code" || options.agent === "all") {
    changes.push(...(await uninstallClaudeCode(options, projectRoot)));
  }
  const excludeChange = await updateGitExclude(
    projectRoot,
    options.agent,
    "uninstall",
    options.dryRun ?? false
  );
  if (excludeChange) {
    changes.push(excludeChange);
  }
  return {
    agent: options.agent,
    projectRoot,
    dryRun: options.dryRun ?? false,
    changes
  };
}

export async function getIntegrationStatus(projectRoot: string): Promise<{
  codex: { hooks: boolean; mcp: boolean; installed: boolean };
  claudeCode: { hooks: boolean; mcp: boolean; installed: boolean };
}> {
  const root = resolve(projectRoot);
  const codexHooksPath = join(root, ".codex", "hooks.json");
  const codexConfig = await readOptional(join(root, ".codex", "config.toml"));
  const codexHooks = parseJsonObject(codexHooksPath, await readOptional(codexHooksPath));
  const codexHookStatus = hasMiraHooks(codexHooks, ["SessionStart", "Stop"]);
  const codexMcpStatus = codexConfig?.includes(CODEX_BLOCK_START) === true && codexConfig.includes(CODEX_BLOCK_END);

  const claudeSettingsPath = join(root, ".claude", "settings.local.json");
  const claudeSettings = parseJsonObject(claudeSettingsPath, await readOptional(claudeSettingsPath));
  const claudeHookStatus = hasMiraHooks(claudeSettings, ["SessionStart", "Stop", "SessionEnd"]);
  const mcpPath = join(root, ".mcp.json");
  const mcp = parseJsonObject(mcpPath, await readOptional(mcpPath));
  const miraMcp = isRecord(mcp.mcpServers) ? mcp.mcpServers.mira : undefined;
  const claudeMcpStatus =
    isRecord(miraMcp) && isRecord(miraMcp.env) && miraMcp.env.MIRA_MANAGED_BY === "mira";

  return {
    codex: {
      hooks: codexHookStatus,
      mcp: codexMcpStatus,
      installed: codexHookStatus && codexMcpStatus
    },
    claudeCode: {
      hooks: claudeHookStatus,
      mcp: claudeMcpStatus,
      installed: claudeHookStatus && claudeMcpStatus
    }
  };
}
