import { describe, expect, test, vi } from "vitest";
import {
  createOpenAiCompatibleProvider,
  providerConfigFromEnv
} from "../../src/distill/openAiCompatibleProvider.js";

describe("OpenAI-compatible distill provider", () => {
  test("reads complete optional provider configuration", () => {
    expect(providerConfigFromEnv({
      MIRA_LLM_BASE_URL: "http://localhost:11434/v1/",
      MIRA_LLM_MODEL: "local-model",
      MIRA_LLM_API_KEY: "local-key"
    })).toEqual({ baseUrl: "http://localhost:11434/v1", model: "local-model", apiKey: "local-key" });
    expect(providerConfigFromEnv({ MIRA_LLM_BASE_URL: "http://localhost/v1" })).toBeUndefined();
  });

  test("requests chat completions and parses fenced candidate JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("ignored", { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"candidates\":[{\"title\":\"Queue\",\"kind\":\"fact\",\"content\":\"Use a durable queue.\",\"evidence\":\"Use a durable queue.\",\"confidence\":0.97,\"importance\":0.8}]}\n```" } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://llm.example/v1/", model: "test-model", apiKey: "test-key"
    }, fetchMock as unknown as typeof fetch);

    const candidates = await provider.distill({ threadId: "thread_1", rawText: "Use a durable queue." });

    expect(candidates[0]).toMatchObject({ title: "Queue", kind: "fact", confidence: 0.97 });
    expect(fetchMock).toHaveBeenCalledWith("https://llm.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-key" })
    }));
  });

  test("rejects malformed responses and reports bounded HTTP errors", async () => {
    const malformedFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    const malformed = createOpenAiCompatibleProvider({ baseUrl: "http://local/v1", model: "m" }, malformedFetch);
    await expect(malformed.distill({ threadId: "t", rawText: "text" })).rejects.toThrow("message content");

    const failedFetch = vi.fn(async () => new Response("upstream failed " + "x".repeat(2_000), { status: 500 })) as unknown as typeof fetch;
    const failed = createOpenAiCompatibleProvider({ baseUrl: "http://local/v1", model: "m" }, failedFetch);
    await expect(failed.distill({ threadId: "t", rawText: "text" })).rejects.toThrow(/HTTP 500/);
  });

  test("does not call an external Provider when the Thread contains a detected secret", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createOpenAiCompatibleProvider(
      { baseUrl: "http://local/v1", model: "m" },
      fetchMock as unknown as typeof fetch
    );

    await expect(provider.distill({
      threadId: "t",
      rawText: "Never send sk-proj-123456789012345678901234567890 outside."
    })).rejects.toThrow(/sensitive/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
