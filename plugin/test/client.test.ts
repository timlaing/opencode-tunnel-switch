import assert from "node:assert/strict";
import { test } from "node:test";
import { Options, detector, makeClient } from "../src/client.js";

test("matches the reported error only for allowed providers and statuses", () => {
  const detect = detector(Options.parse({ apiToken: "secret" }));
  const error = { type: "provider.rate-limit", message: "Error: Rate limit exceeded. Please try again later.", status: 429 };
  assert.equal(detect("opencode", error), true);
  assert.equal(detect("other", error), false);
  assert.equal(detect("opencode", { ...error, status: 500 }), false);
  assert.equal(detect("opencode", { ...error, message: "Temporary capacity error" }), false);
});

test("configurable endpoint, token, and concurrent trigger coalescing", async () => {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetcher: typeof fetch = async (url, init) => {
    count++;
    assert.equal(String(url), "http://[::1]:9876/rotate");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer secret");
    await gate;
    return new Response('{"connection_id":"new"}');
  };
  const client = makeClient(Options.parse({ apiToken: "secret", apiIp: "::1", apiPort: 9876 }), "secret", fetcher);
  const first = client.rotate();
  const second = client.rotate();
  release();
  assert.equal(await first, await second);
  assert.equal(count, 1);
  await assert.rejects(client.rotate(), /cooldown/);
});

test("API failures do not silently report success", async () => {
  const client = makeClient(Options.parse({ apiToken: "secret" }), "secret", async () => new Response("busy", { status: 429 }));
  await assert.rejects(client.rotate(), /429/);
});

test("invalid IP and port fail during setup", () => {
  assert.throws(() => Options.parse({}));
  assert.throws(() => Options.parse({ apiToken: " " }));
  assert.throws(() => Options.parse({ apiToken: "secret", apiPort: 0 }));
  assert.throws(() => Options.parse({ apiToken: "secret", apiIp: "garbage" }));
});
