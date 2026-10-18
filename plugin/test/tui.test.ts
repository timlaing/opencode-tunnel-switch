import assert from "node:assert/strict";
import { test } from "node:test";
import { testRender } from "@opentui/solid";
import type { Context, KeymapLayer, SlotClaim } from "@opencode/plugin/tui/context";
import plugin from "../src/tui.js";

/**
 * Branch coverage for the sidebar renderer. `test/verify-tui.ts` remains the
 * end-to-end bun check; this suite runs under node:test so `src/tui.ts` lands in
 * the lcov report SonarCloud measures.
 */

type View = Awaited<ReturnType<typeof testRender>>;

const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = Date.parse("2026-10-15T11:00:00Z");
let mode: "ok" | "fail" | "hang" = "ok";
let server: string | null = "example-server";
let state = "connected";
const calls: string[] = [];

Date.now = () => now;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const address = input instanceof Request ? input.url : String(input);
  calls.push(`${init?.method} ${new URL(address).pathname}`);
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
  if (mode === "hang") return new Promise<Response>(() => {});
  if (mode === "fail") return Promise.reject(new Error("private-error-must-not-render"));
  return Promise.resolve(new Response(JSON.stringify({
    state,
    connection_id: "example-connection",
    server,
    started_at: "2026-10-15T10:00:00Z",
    http_proxy: { enabled: true, ip: "127.0.0.1", port: 9988 },
  })));
}) as typeof fetch;

interface Harness {
  readonly claim?: SlotClaim;
  readonly layer?: KeymapLayer;
  readonly toasts: Array<Record<string, unknown>>;
  readonly dispose: () => void;
}

async function start(options: Record<string, unknown>): Promise<Harness> {
  const claims: SlotClaim[] = [];
  const layers: KeymapLayer[] = [];
  const toasts: Array<Record<string, unknown>> = [];
  const cleanup = await plugin.setup({
    options,
    theme: { text: { base: "#ffffff", muted: "#aaaaaa" } },
    ui: {
      slot(claim: SlotClaim) { claims.push(claim); return () => {}; },
      toast: { show(value: Record<string, unknown>) { toasts.push(value); } },
    },
    keymap: { layer(factory: () => KeymapLayer) { layers.push(factory()); } },
  } as unknown as Context);
  return {
    claim: claims[0],
    layer: layers[0],
    toasts,
    dispose: () => { cleanup?.(); },
  };
}

async function openView(claim: SlotClaim): Promise<View> {
  return testRender(() => claim.render({ sessionID: "example" } as never), { width: 46, height: 20 });
}

function row(frame: string, label: string): string {
  const match = frame.split("\n").find((candidate) => candidate.includes(`${label}:`));
  assert.ok(match, `missing ${label} row`);
  return match.trimEnd();
}

function reset(next: { mode?: typeof mode; server?: string | null; state?: string } = {}): void {
  mode = next.mode ?? "ok";
  server = "server" in next ? (next.server ?? null) : "example-server";
  state = next.state ?? "connected";
}

test("tunnel-switch sidebar", async (t) => {
  try {
    await t.test("renders the reachable status rows without leaking identifiers", async () => {
      reset();
      const h = await start({ apiToken: "test-token" });
      try {
        assert.equal(h.claim?.append, "sidebar.content");
        await h.layer?.commands?.[0].run();
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          const frame = view.captureCharFrame();
          assert.match(frame, /▼ Tunnel/);
          assert.ok(row(frame, "API").endsWith("reachable"), row(frame, "API"));
          assert.ok(row(frame, "State").endsWith("connected"), row(frame, "State"));
          assert.ok(row(frame, "Server").endsWith("example-server"), row(frame, "Server"));
          assert.ok(row(frame, "Proxy").endsWith("127.0.0.1:9988"), row(frame, "Proxy"));
          assert.match(row(frame, "Started"), /\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{2}$/);
          assert.ok(row(frame, "Checked").endsWith("0s ago"), row(frame, "Checked"));
          assert.doesNotMatch(frame, /ID:|test-token|private-error/);
          assert.ok(calls.every((call) => call === "GET /status"));
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("tints a rotating state and toggles the collapsed summary", async () => {
      reset({ state: "rotating" });
      const h = await start({ apiToken: "test-token" });
      try {
        await h.layer?.commands?.[0].run();
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          assert.ok(row(view.captureCharFrame(), "State").endsWith("rotating"));
          // The toggle handler is intentionally synchronous.
          await h.layer?.commands?.[1].run();
          await view.renderOnce();
          const collapsed = view.captureCharFrame();
          assert.match(collapsed, /▶ Tunnel \(reachable\)/);
          assert.doesNotMatch(collapsed, /Server:/);
          await h.layer?.commands?.[1].run();
          await view.renderOnce();
          assert.ok(row(view.captureCharFrame(), "Server").endsWith("example-server"));
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("uses the error colour for a disconnected state", async () => {
      reset({ state: "disconnected" });
      const h = await start({ apiToken: "test-token" });
      try {
        await h.layer?.commands?.[0].run();
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          const frame = view.captureCharFrame();
          assert.ok(row(frame, "State").endsWith("disconnected"), row(frame, "State"));
          assert.doesNotMatch(frame, /\(last known\)/);
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("marks stale rows once the API stops answering", async () => {
      reset();
      const h = await start({ apiToken: "test-token" });
      try {
        await h.layer?.commands?.[0].run();
        mode = "fail";
        await h.layer?.commands?.[0].run();
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          const frame = view.captureCharFrame();
          assert.ok(row(frame, "API").endsWith("unavailable"), row(frame, "API"));
          assert.ok(row(frame, "State").endsWith("(last known)"), row(frame, "State"));
          assert.ok(row(frame, "Uptime").endsWith("(at last success)"), row(frame, "Uptime"));
          assert.doesNotMatch(frame, /private-error|test-token/);
          await h.layer?.commands?.[1].run();
          await view.renderOnce();
          assert.match(view.captureCharFrame(), /▶ Tunnel \(unavailable\)/);
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("shows the checking placeholder before the first response", async () => {
      reset({ mode: "hang" });
      const h = await start({ apiToken: "test-token" });
      try {
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          assert.match(view.captureCharFrame(), /Checking status…/);
          await h.layer?.commands?.[1].run();
          await view.renderOnce();
          assert.match(view.captureCharFrame(), /▶ Tunnel \(checking…\)/);
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("renders a null server and disabled proxy as em dashes", async () => {
      reset({ server: null });
      const h = await start({ apiToken: "test-token" });
      try {
        await h.layer?.commands?.[0].run();
        const view = await openView(h.claim!);
        try {
          await view.renderOnce();
          assert.ok(row(view.captureCharFrame(), "Server").endsWith("—"));
        } finally {
          view.renderer.destroy();
        }
      } finally {
        h.dispose();
      }
    });

    await t.test("degrades to one actionable toast when options are missing", async () => {
      reset();
      const h = await start({});
      try {
        assert.equal(h.claim, undefined, "sidebar must not register without options");
        assert.equal(h.layer, undefined, "keymap must not register without options");
        assert.equal(h.toasts.length, 1);
        assert.match(String(h.toasts[0]?.message), /apiToken/);
        assert.match(String(h.toasts[0]?.message), /cli\.json/);
      } finally {
        h.dispose();
      }
    });
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});
