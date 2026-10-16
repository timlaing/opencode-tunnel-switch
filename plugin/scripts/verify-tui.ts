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
  const row = (frameText: string, label: string) => {
    const line = frameText.split("\n").find((candidate) => candidate.includes(`${label}:`));
    assert.ok(line, `missing ${label} row`);
    return line.trimEnd();
  };
  assert.match(frame, /▼ Tunnel/);
  assert.ok(row(frame, "API").endsWith("reachable"), row(frame, "API"));
  assert.ok(row(frame, "Server").endsWith("example-server"), row(frame, "Server"));
  assert.ok(row(frame, "Proxy").endsWith("127.0.0.1:9988"), row(frame, "Proxy"));
  assert.match(row(frame, "Started"), /\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{2}$/);
  assert.ok(row(frame, "Checked").endsWith("0s ago"), row(frame, "Checked"));
  assert.doesNotMatch(frame, /ID:/);
  id = "rotated-connection";
  server = "rotated-server";
  await refresh(); await view.renderOnce();
  assert.ok(row(view.captureCharFrame(), "Server").endsWith("rotated-server"));
  now += 60000;
  fail = true;
  await refresh(); await view.renderOnce();
  frame = view.captureCharFrame();
  assert.ok(row(frame, "API").endsWith("unavailable"), row(frame, "API"));
  assert.ok(row(frame, "State").endsWith("(last known)"), row(frame, "State"));
  assert.ok(row(frame, "Uptime").endsWith("(at last check)"), row(frame, "Uptime"));
  assert.doesNotMatch(frame, /private-error|test-token/);
  fail = false;
  await refresh(); await view.renderOnce();
  frame = view.captureCharFrame();
  assert.ok(row(frame, "API").endsWith("reachable"), row(frame, "API"));
  assert.ok(row(frame, "Uptime").endsWith("1h 1m 0s"), row(frame, "Uptime"));
  assert.ok(calls.every(call => call === "GET /status"));
  // Collapsing (like the MCP box) hides the rows and shows a muted summary.
  await layer?.commands?.[1].run(); await view.renderOnce();
  frame = view.captureCharFrame();
  assert.match(frame, /▶ Tunnel \(reachable\)/);
  assert.doesNotMatch(frame, /Server:/);
  await layer?.commands?.[1].run(); await view.renderOnce();
  assert.ok(row(view.captureCharFrame(), "Server").endsWith("rotated-server"));
  console.log(view.captureCharFrame());
  console.log("TUI rendering, refresh, rotation, stale state, collapse and recovery verified.");
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
