import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  getIntegrationStatus,
  installAgentIntegration,
  uninstallAgentIntegration,
  type IntegrationRuntime
} from "../../src/integrations/configInstaller.js";

const runtime: IntegrationRuntime = {
  nodePath: "/opt/node/bin/node",
  entryPath: "/opt/mira/dist/src/index.js"
};

async function setupProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mira-integration-config-"));
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("agent integration config installer", () => {
  test("installs idempotent Codex hooks and a managed MCP block without replacing existing config", async () => {
    const projectRoot = await setupProject();
    await writeFile(join(projectRoot, "existing-hooks.json"), "keep", "utf8");

    const first = await installAgentIntegration({
      agent: "codex",
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    });
    const second = await installAgentIntegration({
      agent: "codex",
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    });

    const hooks = await readJson(join(projectRoot, ".codex", "hooks.json"));
    const config = await readFile(join(projectRoot, ".codex", "config.toml"), "utf8");
    const hookMap = hooks.hooks as Record<string, unknown[]>;

    expect(first.changes.map((change) => change.action)).toEqual(["created", "created"]);
    expect(second.changes.map((change) => change.action)).toEqual(["unchanged", "unchanged"]);
    expect(hookMap.SessionStart).toHaveLength(1);
    expect(hookMap.Stop).toHaveLength(1);
    expect(JSON.stringify(hooks)).toContain("integration hook --agent codex");
    expect(config.match(/# >>> mira managed/g)).toHaveLength(1);
    expect(config).toContain("[mcp_servers.mira]");
    expect(config).toContain("/opt/mira/dist/src/index.js");
  });

  test("merges Claude Code hooks and MCP config while preserving user entries", async () => {
    const projectRoot = await setupProject();
    await writeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { existing: { command: "existing-server", args: [] } }, custom: true }, null, 2),
      "utf8"
    );
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "settings.local.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "existing-stop-hook" }] }]
        }
      }),
      "utf8"
    );

    await installAgentIntegration({
      agent: "claude-code",
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    });
    await installAgentIntegration({
      agent: "claude-code",
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    });

    const settings = await readJson(join(projectRoot, ".claude", "settings.local.json"));
    const mcp = await readJson(join(projectRoot, ".mcp.json"));
    const hooks = settings.hooks as Record<string, unknown[]>;
    const mcpServers = mcp.mcpServers as Record<string, unknown>;

    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.Stop).toHaveLength(2);
    expect(hooks.SessionEnd).toHaveLength(1);
    expect(JSON.stringify(settings).match(/integration hook --agent claude-code/g)).toHaveLength(3);
    expect(mcp.custom).toBe(true);
    expect(mcpServers.existing).toBeDefined();
    expect(mcpServers.mira).toMatchObject({
      type: "stdio",
      command: runtime.nodePath
    });
  });

  test("previews all integration changes without writing files", async () => {
    const projectRoot = await setupProject();

    const result = await installAgentIntegration({
      agent: "all",
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime,
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.changes).toHaveLength(4);
    await expect(readFile(join(projectRoot, ".codex", "hooks.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(projectRoot, ".mcp.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects an unmanaged same-name MCP server without changing it", async () => {
    const projectRoot = await setupProject();
    const mcpPath = join(projectRoot, ".mcp.json");
    const original = JSON.stringify({ mcpServers: { mira: { command: "someone-else" } } }, null, 2);
    await writeFile(mcpPath, original, "utf8");

    await expect(
      installAgentIntegration({
        agent: "claude-code",
        projectRoot,
        dbPath: join(projectRoot, ".mira", "mira.sqlite"),
        runtime
      })
    ).rejects.toThrow(/existing unmanaged Claude Code MCP server named mira/);
    expect(await readFile(mcpPath, "utf8")).toBe(original);
  });

  test("preflights every selected agent before writing any integration file", async () => {
    const projectRoot = await setupProject();
    const mcpPath = join(projectRoot, ".mcp.json");
    await writeFile(
      mcpPath,
      JSON.stringify({ mcpServers: { mira: { command: "unmanaged-server" } } }, null, 2),
      "utf8"
    );

    await expect(
      installAgentIntegration({
        agent: "all",
        projectRoot,
        dbPath: join(projectRoot, ".mira", "mira.sqlite"),
        runtime
      })
    ).rejects.toThrow(/existing unmanaged Claude Code MCP server named mira/);
    await expect(readFile(join(projectRoot, ".codex", "hooks.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("uninstalls only Mira-managed entries and reports status", async () => {
    const projectRoot = await setupProject();
    const options = {
      agent: "all" as const,
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    };
    await installAgentIntegration(options);

    expect(await getIntegrationStatus(projectRoot)).toEqual({
      codex: { hooks: true, mcp: true, installed: true },
      claudeCode: { hooks: true, mcp: true, installed: true }
    });

    const result = await uninstallAgentIntegration({ agent: "all", projectRoot, runtime });

    expect(result.changes.map((change) => change.action)).toEqual(["updated", "updated", "updated", "updated"]);
    expect(await getIntegrationStatus(projectRoot)).toEqual({
      codex: { hooks: false, mcp: false, installed: false },
      claudeCode: { hooks: false, mcp: false, installed: false }
    });
  });

  test("keeps generated machine-local configs out of Git without replacing existing exclude rules", async () => {
    const projectRoot = await setupProject();
    const excludePath = join(projectRoot, ".git", "info", "exclude");
    await mkdir(join(projectRoot, ".git", "info"), { recursive: true });
    await writeFile(excludePath, "*.local-cache\n", "utf8");
    const options = {
      agent: "all" as const,
      projectRoot,
      dbPath: join(projectRoot, ".mira", "mira.sqlite"),
      runtime
    };

    const first = await installAgentIntegration(options);
    const second = await installAgentIntegration(options);
    const installedExclude = await readFile(excludePath, "utf8");

    expect(first.changes).toHaveLength(5);
    expect(first.changes.at(-1)).toMatchObject({ path: excludePath, action: "updated" });
    expect(second.changes.map((change) => change.action)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged"
    ]);
    expect(installedExclude).toContain("*.local-cache");
    expect(installedExclude).toContain("# >>> mira integration local config");
    expect(installedExclude).toContain(".codex/hooks.json");
    expect(installedExclude).toContain(".codex/config.toml");
    expect(installedExclude).toContain(".claude/settings.local.json");
    expect(installedExclude).toContain(".mcp.json");

    await uninstallAgentIntegration({ agent: "codex", projectRoot });
    const afterCodex = await readFile(excludePath, "utf8");
    expect(afterCodex).not.toContain(".codex/hooks.json");
    expect(afterCodex).toContain(".claude/settings.local.json");

    await uninstallAgentIntegration({ agent: "claude-code", projectRoot });
    const uninstalledExclude = await readFile(excludePath, "utf8");
    expect(uninstalledExclude).toBe("*.local-cache\n");
  });
});
