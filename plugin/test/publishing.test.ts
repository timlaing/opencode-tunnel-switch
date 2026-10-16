import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));
for (const scenario of ["missing", "same", "different", "unauthorized"] as const) {
  test(`publishing handles ${scenario} versions without unsafe overwrite`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-publish-test-"));
    const log = path.join(directory, "calls.jsonl");
    const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", filename: "package.tgz", integrity: "sha512-tested" }]);
    writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'publish') process.exit(0);
if (process.env.TEST_NPM_SCENARIO === 'missing' || process.env.TEST_NPM_SCENARIO === 'unauthorized') {
  console.log(JSON.stringify({ error: { code: process.env.TEST_NPM_SCENARIO === 'missing' ? 'E404' : 'E401' } }));
  process.exit(1);
}
console.log(JSON.stringify(process.env.TEST_NPM_SCENARIO === 'same' ? 'sha512-tested' : 'sha512-different'));
`, { mode: 0o755 });
    try {
      const result = spawnSync(process.execPath, [script], {
        cwd: directory, encoding: "utf8", input: manifest,
        env: { ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), TEST_NPM_LOG: log, TEST_NPM_SCENARIO: scenario },
      });
      const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      if (scenario === "missing" || scenario === "same") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
      assert.equal(calls.some((args) => args[0] === "publish"), scenario === "missing");
      if (scenario === "missing") assert.ok(calls[1].includes("--registry=https://npm.pkg.github.com"));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

const verifyScript = fileURLToPath(new URL("../scripts/verify-published-package.mjs", import.meta.url));
for (const scenario of ["valid", "wrong-integrity", "wrong-repository", "wrong-version"] as const) {
  test(`registry readback rejects invalid metadata: ${scenario}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-readback-test-"));
    const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.1", integrity: "sha512-tested" }]);
    const published = {
      name: "@timlaing/opencode-tunnel-switch",
      version: scenario === "wrong-version" ? "9.9.9" : "0.1.1",
      dist: { integrity: scenario === "wrong-integrity" ? "sha512-other" : "sha512-tested" },
      repository: { url: scenario === "wrong-repository" ? "git+https://github.com/example/other.git" : "git+https://github.com/timlaing/opencode-tunnel-switch.git" },
    };
    writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(published))});\n`, { mode: 0o755 });
    try {
      const result = spawnSync(process.execPath, [verifyScript], { encoding: "utf8", input: manifest, env: { ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs") } });
      if (scenario === "valid") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("publishing helpers reject missing or relative npm CLI paths before spawning", () => {
  const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", integrity: "sha512-tested" }]);
  for (const npmCli of ["", "relative/npm-cli.js"]) {
    const result = spawnSync(process.execPath, [verifyScript], {
      encoding: "utf8", input: manifest, env: { ...process.env, npm_execpath: npmCli },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm_execpath is absolute/);
  }
});

const verifyPackScript = fileURLToPath(new URL("../scripts/verify-package.ts", import.meta.url));
test("pack-metadata tools reject stale manifest-path invocations", () => {
  const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", integrity: "sha512-tested" }]);
  for (const target of [script, verifyScript, verifyPackScript]) {
    const result = spawnSync(process.execPath, [target, "pack.json"], {
      encoding: "utf8", input: manifest, env: { ...process.env, npm_execpath: "/abs/npm-cli.js" },
    });
    assert.notEqual(result.status, 0, target);
    assert.match(result.stderr, /reads pack JSON from stdin/, target);
  }
});

test("runNpm prefers the Node binary recorded by npm over the invoking runtime", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-nodecli-test-"));
  const log = path.join(directory, "calls.jsonl");
  const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.1", integrity: "sha512-tested" }]);
  const published = {
    name: "@timlaing/opencode-tunnel-switch",
    version: "0.1.1",
    dist: { integrity: "sha512-tested" },
    repository: { url: "git+https://github.com/timlaing/opencode-tunnel-switch.git" },
  };
  writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(published))});\n`, { mode: 0o755 });
  const wrapper = path.join(directory, "node-wrapper.sh");
  writeFileSync(wrapper, `#!/bin/sh\necho "interpreter=$0" >> "$TEST_NPM_LOG"\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  const baseEnv = { ...process.env };
  delete baseEnv.npm_node_execpath;
  try {
    const result = spawnSync(process.execPath, [verifyScript], {
      encoding: "utf8", input: manifest,
      env: { ...baseEnv, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), npm_node_execpath: wrapper, TEST_NPM_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(log, "utf8").includes(`interpreter=${wrapper}`), "npm_node_execpath should act as the interpreter");
    rmSync(log);
    const fallback = spawnSync(process.execPath, [verifyScript], {
      encoding: "utf8", input: manifest,
      env: { ...baseEnv, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), TEST_NPM_LOG: log },
    });
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.ok(!existsSync(log) || !readFileSync(log, "utf8").includes("interpreter="), "should fall back to process.execPath");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
