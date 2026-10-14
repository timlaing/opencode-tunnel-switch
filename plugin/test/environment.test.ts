import assert from "node:assert/strict";
import { test } from "node:test";
import { Options, makeClient } from "../src/client.js";
import { configureProcessProxy } from "../src/environment.js";

const options = (extra = {}) => {
  const parsed = Options.parse({ apiToken: "secret", ...extra });
  return { ...parsed, proxyPort: parsed.proxyPort ?? 8118 };
};

test("sets every proxy variable and bypasses REST, loopback and existing exclusions", () => {
  const env = { HTTPS_PROXY: "http://old:1234", NO_PROXY: "internal.example", no_proxy: "other.example" };
  const original = { ...env };
  const restore = configureProcessProxy(options({ apiIp: "192.0.2.10", proxyPort: 9999, noProxy: ["local.example"] }), env);
  assert.equal(env.HTTPS_PROXY, "http://192.0.2.10:9999");
  assert.equal((env as NodeJS.ProcessEnv).http_proxy, env.HTTPS_PROXY);
  assert.equal((env as NodeJS.ProcessEnv).ALL_PROXY, env.HTTPS_PROXY);
  for (const host of ["192.0.2.10", "localhost", "127.0.0.1", "::1", "internal.example", "other.example", "local.example"])
    assert.ok(env.NO_PROXY.split(",").includes(host));
  restore();
  restore();
  assert.deepEqual(env, original);
});

test("multiple project instances restore correctly in either unload order", () => {
  const env: NodeJS.ProcessEnv = {};
  const first = configureProcessProxy(options({ proxyIp: "::1" }), env);
  const second = configureProcessProxy(options({ proxyPort: 9999 }), env);
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:9999");
  first();
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:9999");
  second();
  assert.deepEqual(env, {});
  const third = configureProcessProxy(options({ proxyPort: 9999 }), env);
  const fourth = configureProcessProxy(options({ proxyIp: "::1" }), env);
  assert.equal(env.HTTP_PROXY, "http://[::1]:8118");
  fourth();
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:9999");
  third();
  assert.deepEqual(env, {});
});

test("cleanup preserves later external edits and opt-out changes nothing", () => {
  const env: NodeJS.ProcessEnv = {};
  const restore = configureProcessProxy(options(), env);
  env.HTTP_PROXY = "http://manual:8080";
  restore();
  assert.deepEqual(env, { HTTP_PROXY: "http://manual:8080" });
  configureProcessProxy(options({ configureProxy: false }), env)();
  assert.deepEqual(env, { HTTP_PROXY: "http://manual:8080" });
});

test("REST fetch explicitly bypasses Bun proxy routing", async () => {
  const client = makeClient(options(), "secret", async (_url, init) => {
    assert.equal((init as RequestInit & { proxy: boolean }).proxy, false);
    return new Response("{}");
  });
  await client.status();
});
