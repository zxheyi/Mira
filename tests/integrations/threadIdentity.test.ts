import { describe, expect, test } from "vitest";
import { stableThreadId } from "../../src/integrations/threadIdentity.js";

describe("stable thread identity", () => {
  test("matches the existing Hook thread ids", () => {
    expect(stableThreadId("codex", "Session-Codex")).toBe("thread_codex_session_codex");
    expect(stableThreadId("claude-code", "session/claude")).toBe("thread_claude_code_session_claude");
  });
});
