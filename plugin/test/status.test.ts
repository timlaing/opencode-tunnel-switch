import test from "node:test";
import assert from "node:assert/strict";
import { Options } from "../src/client.js";
import { parseStatus, uptime, watchStatus } from "../src/status.js";
const options = Options.parse({ apiToken: "test-token" });
const response = JSON.stringify({ state: "connected", connection_id: "example-id",
  started_at: "2026-10-15T10:00:00Z", server: "example",
  http_proxy: { enabled: true, ip: "0.0.0.0", port: 9988 }, last_error: "private details" });

test("status validates fields and omits private errors, resolves proxy wildcard", () => {
  const status = parseStatus(response, options);
  assert.equal(status.proxy, "127.0.0.1:9988");
  assert.equal(status.connection_id, "example-id");
  assert.equal("last_error" in status, false);
  assert.throws(() => parseStatus('{}', options));
  const disconnected = JSON.stringify({ state: "disconnected", connection_id: null,
    started_at: null, http_proxy: { enabled: false } });
  assert.equal(parseStatus(disconnected, options).proxy, "Disabled");
  assert.equal(uptime(null, Date.now()), "—");
  assert.equal(uptime(status.started_at, Date.parse("2026-10-15T11:02:03Z")), "1h 2m 3s");
  assert.equal(uptime(status.started_at, 0), "0h 0m 0s");
});

test("polling coalesces refresh, marks old data stale, recovers, and stops updates", async () => {
  let release!: (value: string) => void;
  let calls = 0;
  let fail = false;
  const updates: Array<{ available: boolean; id?: string }> = [];
  const watcher = watchStatus(async () => {
    calls++;
    if (fail) throw new Error("secret server response");
    return new Promise<string>(resolve => { release = resolve; });
  }, options, (status, available) => updates.push({ available, id: status?.connection_id ?? undefined }));
  try {
    const first = watcher.refresh();
    assert.equal(calls, 1);
    release(response);
    await first;
    fail = true;
    await watcher.refresh();
    assert.deepEqual(updates, [{ available: true, id: "example-id" }, { available: false, id: "example-id" }]);
    fail = false;
    const recovered = watcher.refresh();
    release(response);
    await recovered;
    assert.equal(updates.at(-1)?.available, true);
    const pending = watcher.refresh();
    watcher.stop();
    release(response);
    await pending;
    await watcher.refresh();
    assert.equal(updates.length, 3);
    assert.equal(calls, 4);
  } finally { watcher.stop(); }
});

test("polling refreshes automatically without overlapping slow calls", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let done!: () => void;
  const completed = new Promise<void>(resolve => { done = resolve; });
  const watcher = watchStatus(async () => {
    calls++; active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return response;
  }, options, () => { if (calls === 2) done(); }, 1);
  try { await completed; assert.equal(maxActive, 1); } finally { watcher.stop(); }
});
