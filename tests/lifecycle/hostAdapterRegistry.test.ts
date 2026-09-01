import { describe, expect, test } from "vitest";
import { createHostAdapterRegistry } from "../../src/lifecycle/hostAdapterRegistry.js";

describe("Host Adapter Registry", () => {
  test("discovers all supported Hosts and normalizes their stable turn identities", () => {
    const registry = createHostAdapterRegistry();

    expect(registry.list()).toEqual([
      expect.objectContaining({host: "codex", adapterRole:"source_host",beforeTurn: true, afterTurn: true}),
      expect.objectContaining({host: "claude-code", adapterRole:"source_host",beforeTurn: true, afterTurn: true}),
      expect.objectContaining({host: "cursor", adapterRole:"source_host",beforeTurn: true, afterTurn: true}),
      expect.objectContaining({host: "cli", adapterRole:"transport",beforeTurn: true, afterTurn: true}),
      expect.objectContaining({host: "mcp", adapterRole:"transport",beforeTurn: true, afterTurn: true}),
      expect.objectContaining({host: "ui", adapterRole:"transport",beforeTurn: true, afterTurn: true})
    ]);

    expect(registry.normalizeBeforeTurn("codex", {
      session_id: "session-1", turn_id: "turn-1", prompt: "Continue the migration.", task_id: "migration"
    })).toEqual({
      host: "codex", hostSessionId: "session-1", hostTurnId: "turn-1",
      query: "Continue the migration.", taskId: "migration"
    });
    expect(registry.normalizeAfterTurn("ui", {
      sessionId: "session-ui", turnId: "turn-ui", query: "Review the source.",
      response: "Review completed.", status: "succeeded"
    })).toEqual({
      host: "ui", hostSessionId: "session-ui", hostTurnId: "turn-ui",
      query: "Review the source.", response: "Review completed.", outcomeStatus: "succeeded"
    });
  });

  test("rejects unknown Hosts, unstable identities, extra fields and invalid outcomes", () => {
    const registry = createHostAdapterRegistry();
    expect(() => registry.normalizeBeforeTurn("unknown", {
      sessionId: "s", turnId: "t", query: "q"
    })).toThrow(/Unsupported Host/);
    expect(() => registry.normalizeBeforeTurn("cli", {
      sessionId: "", turnId: "t", query: "q"
    })).toThrow(/session/i);
    expect(() => registry.normalizeAfterTurn("mcp", {
      sessionId: "s", turnId: "t", query: "q", response: "r", status: "unknown"
    })).toThrow(/Invalid Host input/);
    expect(() => registry.normalizeBeforeTurn("cursor", {
      sessionId: "s", turnId: "t", query: "q", confirmationPolicy: {actor: "forged"}
    })).toThrow(/Invalid Host input/);
  });
});
