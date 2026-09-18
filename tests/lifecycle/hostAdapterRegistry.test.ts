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

  test.each(["camel", "snake"] as const)("%s input accepts a complete transcript up to five million characters", style => {
    const registry = createHostAdapterRegistry();
    const rawText = "x".repeat(5_000_000);
    const identity = style === "camel"
      ? {sessionId: "long-session", turnId: "long-turn", query: "Capture the session."}
      : {session_id: "long-session", turn_id: "long-turn", prompt: "Capture the session."};
    const input = {...identity, response: "Captured.", status: "succeeded",
      transcript: {threadId: "long-thread", title: "Long session", rawFormat: "jsonl", rawText}};

    const command = registry.normalizeAfterTurn("claude-code", input);
    expect(command.transcript?.rawText.length).toBe(5_000_000);
    expect(command.transcript?.rawText).toBe(rawText);
    expect(() => registry.normalizeAfterTurn("claude-code", {
      ...input, transcript: {...input.transcript, rawText: rawText + "x"}
    })).toThrow(/transcript.rawText.*5000000/);
  });

  test.each(["camel", "snake"] as const)("%s input still bounds individual queries and responses at fifty thousand characters", style => {
    const registry = createHostAdapterRegistry();
    const body = "x".repeat(50_000);
    const beforeInput = (query: string) => style === "camel"
      ? {sessionId: "s", turnId: "t", query}
      : {session_id: "s", turn_id: "t", prompt: query};
    expect(registry.normalizeBeforeTurn("codex", beforeInput(body)).query).toBe(body);
    expect(() => registry.normalizeBeforeTurn("codex", beforeInput(body + "x"))).toThrow(/50000/);
    expect(registry.normalizeAfterTurn("claude-code", {...beforeInput(body), response: body, status: "succeeded"}))
      .toMatchObject({query: body, response: body});
    expect(() => registry.normalizeAfterTurn("claude-code", {...beforeInput(body + "x"), response: "Short.", status: "succeeded"}))
      .toThrow(/50000/);
    expect(() => registry.normalizeAfterTurn("claude-code", {...beforeInput("Short."), response: body + "x", status: "succeeded"}))
      .toThrow(/50000/);
  });
});
