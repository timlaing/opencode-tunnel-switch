import test from "node:test";
import assert from "node:assert/strict";
import { Options } from "../src/client.js";
import { watchConnection } from "../src/reconnect.js";

const options = Options.parse({ apiToken: "test-token", reconnectMs: 10000 });

const connected = JSON.stringify({ state: "connected", connection_id: "cid",
  started_at: "2026-10-15T10:00:00Z", http_proxy: { enabled: true, ip: "127.0.0.1", port: 9988 } });
const disconnected = JSON.stringify({ state: "disconnected", connection_id: null,
  started_at: null, http_proxy: { enabled: false } });
const rotating = JSON.stringify({ state: "rotating", connection_id: null,
  started_at: null, http_proxy: { enabled: true, ip: "127.0.0.1", port: 9988 } });

test("issues an initial status read on creation and coalesces refreshes", async () => {
  let reads = 0;
  let release!: (value: string) => void;
  const watcher = watchConnection(async () => {
    reads++;
    return new Promise<string>(resolve => { release = resolve; });
  }, async () => "rotated", options, 10000);
  try {
    assert.equal(reads, 1);
    const pending = watcher.refresh();
    release(connected);
    await pending;
    assert.equal(reads, 1);
  } finally { watcher.stop(); }
});

test("rotates once when disconnected and not again while connected", async () => {
  let reads = 0;
  let rotates = 0;
  const reasons: string[] = [];
  let release!: (value: string) => void;
  const watcher = watchConnection(async () => {
    reads++;
    return new Promise<string>(resolve => { release = resolve; });
  }, async (reason) => { rotates++; reasons.push(reason ?? ""); return "rotated"; }, options, 10000);
  try {
    const pending = watcher.refresh();
    release(disconnected);
    await pending;
    assert.equal(reads, 1);
    assert.equal(rotates, 1);
    assert.equal(reasons[0], "auto-reconnect: tunnel disconnected");
    const recovered = watcher.refresh();
    release(connected);
    await recovered;
    assert.equal(rotates, 1);
  } finally { watcher.stop(); }
});

test("does not rotate while already rotating", async () => {
  let rotates = 0;
  let release!: (value: string) => void;
  const watcher = watchConnection(async () => {
    return new Promise<string>(resolve => { release = resolve; });
  }, async () => { rotates++; return "rotated"; }, options, 10000);
  try {
    const pending = watcher.refresh();
    release(rotating);
    await pending;
    assert.equal(rotates, 0);
  } finally { watcher.stop(); }
});

test("status API failure does not rotate or reject the refresh", async () => {
  let rotates = 0;
  const watcher = watchConnection(async () => { throw new Error("the API is down"); },
    async () => { rotates++; return "rotated"; }, options, 10000);
  try {
    await watcher.refresh();
    assert.equal(rotates, 0);
  } finally { watcher.stop(); }
});

test("stop clears the timer and ignores later refreshes", async () => {
  let reads = 0;
  let release!: (value: string) => void;
  const watcher = watchConnection(async () => {
    reads++;
    return new Promise<string>(resolve => { release = resolve; });
  }, async () => "rotated", options, 10000);
  try {
    const pending = watcher.refresh();
    release(connected);
    await pending;
    assert.equal(reads, 1);
    watcher.stop();
    await watcher.refresh();
    assert.equal(reads, 1);
  } finally {}
});

test("a disconnected response released after stop does not rotate", async () => {
  let rotates = 0;
  let release!: (value: string) => void;
  const watcher = watchConnection(async () => {
    return new Promise<string>(resolve => { release = resolve; });
  }, async () => { rotates++; return "rotated"; }, options, 10000);
  try {
    const pending = watcher.refresh();
    watcher.stop();
    release(disconnected);
    await pending;
    assert.equal(rotates, 0);
  } finally {}
});
