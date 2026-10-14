import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));
for (const scenario of ["missing", "same", "different", "unauthorized"] as const) {
  test(`publishing handles ${scenario} versions without unsafe overwrite`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-publish-test-"));
    const log = path.join(directory, "calls.jsonl");
    const manifest = path.join(directory, "pack.json");
    writeFileSync(manifest, JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", filename: "package.tgz", integrity: "sha512-tested" }]));
    writeFileSync(path.join(directory, "npm"), `#!/usr/bin/env node
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
      const result = spawnSync(process.execPath, [script, manifest], {
        cwd: directory, encoding: "utf8",
        env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, TEST_NPM_LOG: log, TEST_NPM_SCENARIO: scenario },
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
    const manifest = path.join(directory, "pack.json");
    writeFileSync(manifest, JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.1", integrity: "sha512-tested" }]));
    const published = {
      name: "@timlaing/opencode-tunnel-switch",
      version: scenario === "wrong-version" ? "9.9.9" : "0.1.1",
      dist: { integrity: scenario === "wrong-integrity" ? "sha512-other" : "sha512-tested" },
      repository: { url: scenario === "wrong-repository" ? "git+https://github.com/example/other.git" : "git+https://github.com/timlaing/opencode-tunnel-switch.git" },
    };
    writeFileSync(path.join(directory, "npm"), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(published))});\n`, { mode: 0o755 });
    try {
      const result = spawnSync(process.execPath, [verifyScript, manifest], { encoding: "utf8", env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` } });
      if (scenario === "valid") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
