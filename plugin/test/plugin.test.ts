import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../src/index.js";
import type { SessionRetry } from "@opencode/plugin/promise/session";

test("v2 hook requests bounded retry and status command needs no model", async () => {
  const original = globalThis.fetch;
  let rotateCalls = 0;
  let fail = false;
  const messages: string[] = [];
  let hook!: (event: SessionRetry) => Promise<void>;
  let command!: { name: string; execute: (input: { sessionID: string }) => Promise<void> };
  globalThis.fetch = async (url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
    if (String(url).endsWith("rotate")) rotateCalls++;
    if (fail) return new Response("failed", { status: 503 });
    return new Response('{"state":"connected","connection_id":"test-id","started_at":"2026-10-14T12:00:00Z","http_proxy":{"enabled":true,"ip":"127.0.0.1","port":9988}}');
  };
  const ctx = {
    options: { cooldownMs: 0, apiToken: "test-token" },
    session: {
      hook: async (name: string, callback: typeof hook) => { assert.equal(name, "retry"); hook = callback; },
      synthetic: async ({ text }: { text: string }) => { messages.push(text); },
    },
    command: { transform: async (callback: (editor: { add: (definition: typeof command) => void }) => void) =>
      callback({ add: (definition) => { command = definition; } }) },
  } as unknown as Parameters<typeof plugin.setup>[0];
  let cleanup: Awaited<ReturnType<typeof plugin.setup>> = undefined;
  try {
    cleanup = await plugin.setup(ctx);
    assert.equal(process.env.HTTP_PROXY, "http://127.0.0.1:9988");
    const event = {
      sessionID: "session", agent: "build", model: { providerID: "opencode", id: "free" },
      error: { type: "provider.rate-limit", message: "Rate limit exceeded. Please try again later.", status: 429 },
      attempt: 2, decision: { retry: false },
    } as SessionRetry;
    await hook(event);
    assert.deepEqual(event.decision, { retry: true, delay: 1000 });
    assert.equal(rotateCalls, 1);
    await hook({ ...event, attempt: 3 });
    assert.equal(rotateCalls, 1);
    assert.equal(command.name, "tunnel-status");
    await command.execute({ sessionID: "session" });
    assert.match(messages.at(-1)!, /test-id/);
    fail = true;
    const failure = { ...event, decision: { retry: true, delay: 1000 } as SessionRetry["decision"] };
    await hook(failure);
    assert.deepEqual(failure.decision, { retry: false });
  } finally {
    if (typeof cleanup === "function") await cleanup();
    globalThis.fetch = original;
  }
});


test("failed hook registration restores the server process environment", async () => {
  const original = { ...process.env };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    http_proxy: { enabled: true, ip: "127.0.0.1", port: 9999 },
  }));
  const ctx = {
    options: { apiToken: "test-token" },
    session: { hook: async () => { throw new Error("registration failed"); } },
  } as unknown as Parameters<typeof plugin.setup>[0];
  try {
    await assert.rejects(async () => await plugin.setup(ctx), /registration failed/);
    assert.deepEqual({ ...process.env }, original);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [description, response] of [
  ["unavailable API", () => new Response("unavailable", { status: 503 })],
  ["invalid status", () => new Response("{}")],
  ["disabled proxy", () => new Response(JSON.stringify({ http_proxy: { enabled: false, ip: "127.0.0.1", port: 8118 } }))],
] as const) {
  test(`discovery failure leaves environment and registrations untouched: ${description}`, async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = { ...process.env };
    globalThis.fetch = async () => response();
    const ctx = {
      options: { apiToken: "secret" },
      session: { hook: async () => assert.fail("Must not register before discovery succeeds") },
    } as unknown as Parameters<typeof plugin.setup>[0];
    try {
      await assert.rejects(async () => await plugin.setup(ctx), /Proxy discovery failed/);
      assert.deepEqual({ ...process.env }, originalEnv);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("configureProxy false skips startup discovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  globalThis.fetch = async () => assert.fail("No startup request when proxy setup is disabled");
  const ctx = {
    options: { apiToken: "secret", configureProxy: false },
    session: { hook: async () => {} }, command: { transform: async () => {} },
  } as unknown as Parameters<typeof plugin.setup>[0];
  try {
    const cleanup = await plugin.setup(ctx);
    if (typeof cleanup === "function") await cleanup();
    assert.deepEqual({ ...process.env }, originalEnv);
  } finally { globalThis.fetch = originalFetch; }
});
