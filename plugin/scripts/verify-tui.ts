import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import type { Context, SlotClaim, KeymapLayer } from "@opencode/plugin/tui/context";
import plugin from "../src/tui.js";
const originalFetch = globalThis.fetch;
let claim: SlotClaim | undefined;
let layer: KeymapLayer | undefined;
let fail = false;
let id = "example-connection";
let removed = false;
const calls: string[] = [];
globalThis.fetch = (async (url, init) => {
  calls.push(`${init?.method} ${new URL(String(url)).pathname}`);
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
  if (fail) throw new Error("private-error-must-not-render");
  return new Response(JSON.stringify({ state: "connected", connection_id: id,
    started_at: "2026-10-15T10:00:00Z", server: "example-server",
    http_proxy: { enabled: true, ip: "127.0.0.1", port: 9988 } }));
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
  assert.match(frame, /API reachable/);
  assert.match(frame, /example-connection/);
  assert.match(frame, /127.0.0.1:9988/);
  id = "rotated-connection";
  await refresh(); await view.renderOnce();
  assert.match(view.captureCharFrame(), /rotated-connection/);
  fail = true;
  await refresh(); await view.renderOnce();
  frame = view.captureCharFrame();
  assert.match(frame, /API unavailable/);
  assert.match(frame, /last known/);
  assert.doesNotMatch(frame, /private-error|test-token/);
  fail = false;
  await refresh(); await view.renderOnce();
  assert.match(view.captureCharFrame(), /API reachable/);
  assert.ok(calls.every(call => call === "GET /status"));
  console.log(view.captureCharFrame());
  console.log("TUI rendering, refresh, rotation, stale state and recovery verified.");
} finally {
  await cleanup?.(); view.renderer.destroy(); globalThis.fetch = originalFetch;
}
assert.equal(removed, true);
