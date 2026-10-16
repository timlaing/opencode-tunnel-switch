import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import type { Context, SlotClaim, KeymapLayer } from "@opencode/plugin/tui/context";
import plugin from "../src/tui.js";
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = Date.parse("2026-10-15T11:00:00Z");
Date.now = () => now;
let claim: SlotClaim | undefined;
let layer: KeymapLayer | undefined;
let fail = false;
let id = "example-connection";
let server = "example-server";
let removed = false;
const calls: string[] = [];
globalThis.fetch = ((url, init) => {
  const address = url instanceof Request ? url.url : url;
  calls.push(`${init?.method} ${new URL(address).pathname}`);
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
  if (fail) return Promise.reject(new Error("private-error-must-not-render"));
  return Promise.resolve(new Response(JSON.stringify({ state: "connected", connection_id: id, server,
    started_at: "2026-10-15T10:00:00Z",
    http_proxy: { enabled: true, ip: "127.0.0.1", port: 9988 } })));
}) as typeof fetch;
const cleanup = await plugin.setup({
  options: { apiToken: "test-token" },
  theme: { text: { base: "#ffffff", muted: "#aaaaaa" } },
  ui: { slot(value: SlotClaim) { claim = value; return () => { removed = true; }; } },
  keymap: { layer(factory: () => KeymapLayer) { layer = factory(); } },
} as unknown as Context);
assert.equal(claim?.append, "sidebar.content");
const refresh = async () => { await layer?.commands?.[0].run(); };
const view = await testRender(() => claim!.render({ sessionID: "example" } as never), { width: 42, height: 20 });
try {
  await refresh(); await view.renderOnce();
  let frame = view.captureCharFrame();
  assert.match(frame, /Tunnel/);
  assert.match(frame, /API: reachable/);
  assert.match(frame, /Server: example-server/);
  assert.match(frame, /127\.0\.0\.1:9988/);
  assert.match(frame, /Started: \d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{2}/);
  assert.match(frame, /Checked: 0s ago/);
  assert.doesNotMatch(frame, /ID:/);
  id = "rotated-connection";
  server = "rotated-server";
  await refresh(); await view.renderOnce();
  assert.match(view.captureCharFrame(), /Server: rotated-server/);
  now += 60000;
  fail = true;
  await refresh(); await view.renderOnce();
  frame = view.captureCharFrame();
  assert.match(frame, /API: unavailable/);
  assert.match(frame, /last known/);
  assert.match(frame, /Uptime: 1h 0m 0s/);
  assert.match(frame, /successful\s+check/);
  assert.doesNotMatch(frame, /private-error|test-token/);
  fail = false;
  await refresh(); await view.renderOnce();
  assert.match(view.captureCharFrame(), /API: reachable/);
  assert.match(view.captureCharFrame(), /Uptime: 1h 1m 0s/);
  assert.ok(calls.every(call => call === "GET /status"));
  console.log(view.captureCharFrame());
  console.log("TUI rendering, refresh, rotation, stale state and recovery verified.");
} finally {
  await cleanup?.(); view.renderer.destroy(); globalThis.fetch = originalFetch; Date.now = originalNow;
}
assert.equal(removed, true);
// Missing options (the TUI runtime drops opencode.json options) must degrade quietly.
const toasts: Array<Record<string, unknown>> = [];
const degraded = await plugin.setup({
  options: {},
  theme: { text: { base: "#ffffff", muted: "#aaaaaa" } },
  ui: {
    slot() { throw new Error("sidebar must not register without options"); },
    toast: { show(value: Record<string, unknown>) { toasts.push(value); } },
  },
  keymap: { layer() { throw new Error("keymap must not register without options"); } },
} as unknown as Context);
assert.equal(toasts.length, 1);
assert.match(String(toasts[0]?.message), /apiToken/);
assert.match(String(toasts[0]?.message), /cli\.json/);
degraded?.();
console.log("Missing options degrade to one actionable toast.");
