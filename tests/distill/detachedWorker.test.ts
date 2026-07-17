import { describe, expect, test } from "vitest";
import { startDetachedDistillWorker } from "../../src/distill/detachedWorker.js";

describe("detached distill worker launcher", () => {
  test("rejects asynchronous spawn errors instead of leaving an unhandled event", async () => {
    await expect(startDetachedDistillWorker({
      nodePath: "/path/that/does/not/exist/node",
      entryPath: "/missing/mira.js",
      dbPath: "/tmp/mira.sqlite",
      projectRoot: "/tmp/project",
      env: {}
    })).rejects.toThrow();
  });
});
