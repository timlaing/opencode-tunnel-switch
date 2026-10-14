import assert from "node:assert/strict";
import { test } from "node:test";
import { Options } from "../src/client.js";
import { discoverProxy } from "../src/discovery.js";

const options = (extra = {}) => Options.parse({ apiToken: "secret", ...extra });
const status = (ip = "127.0.0.1", port = 9876, enabled = true) => JSON.stringify({ http_proxy: { ip, port, enabled } });

test("uses service configuration without proxy options in OpenCode", () => {
  assert.deepEqual(discoverProxy(options(), status()), { proxyIp: "127.0.0.1", proxyPort: 9876 });
  assert.deepEqual(discoverProxy(options(), status("::1")), { proxyIp: "::1", proxyPort: 9876 });
});

test("wildcard listeners resolve to the REST IP", () => {
  assert.deepEqual(discoverProxy(options({ apiIp: "192.0.2.10" }), status("0.0.0.0")), { proxyIp: "192.0.2.10", proxyPort: 9876 });
  assert.deepEqual(discoverProxy(options({ apiIp: "2001:db8::1" }), status("::")), { proxyIp: "2001:db8::1", proxyPort: 9876 });
});

test("explicit overrides support alternate reachable addresses and ports", () => {
  assert.deepEqual(discoverProxy(options({ proxyIp: "192.0.2.20", proxyPort: 9999 }), status()), { proxyIp: "192.0.2.20", proxyPort: 9999 });
  assert.deepEqual(discoverProxy(options({ proxyPort: 9999 }), status("::1")), { proxyIp: "::1", proxyPort: 9999 });
  assert.throws(() => discoverProxy(options({ proxyIp: "0.0.0.0" }), status()), /wildcard/);
});

test("disabled and malformed responses fail clearly", () => {
  assert.throws(() => discoverProxy(options(), status("127.0.0.1", 9876, false)), /disabled/);
  for (const body of ["invalid json", "{}", status("invalid"), status("127.0.0.1", 0), status("127.0.0.1", 65536)])
    assert.throws(() => discoverProxy(options(), body), /Proxy discovery failed/);
});
