import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));
const scenarios = {
  // per-registry state of the tested version: missing | same | badrepo | different | unauthorized
  missing: { npmjs: "missing", gh: "missing", publishes: 2, status: 0 },
  same: { npmjs: "same", gh: "same", publishes: 0, status: 0 },
  different: { npmjs: "different", gh: "same", publishes: 0, status: 1 },
  // Matching integrity with wrong repository metadata must also abort early.
  "bad-repository": { npmjs: "badrepo", gh: "missing", publishes: 0, status: 1 },
  unauthorized: { npmjs: "unauthorized", gh: "missing", publishes: 0, status: 1 },
  // GH divergence must abort before anything is uploaded to npm.
  "gh-diverges": { npmjs: "missing", gh: "different", publishes: 0, status: 1 },
} as const;
for (const [scenario, expected] of Object.entries(scenarios)) {
  test(`publishing handles ${scenario} versions without unsafe overwrite`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-publish-test-"));
    const log = path.join(directory, "calls.jsonl");
    const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", filename: "package.tgz", integrity: "sha512-tested" }]);
    writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'publish') process.exit(0);
const state = process.env[process.argv.includes('--registry=https://registry.npmjs.org') ? 'TEST_NPM_NPMJS' : 'TEST_NPM_GH'];
if (state === 'missing' || state === 'unauthorized') {
  console.log(JSON.stringify({ error: { code: state === 'missing' ? 'E404' : 'E401' } }));
  process.exit(1);
}
// npm view with multiple fields returns flat dotted keys.
console.log(JSON.stringify({
  'dist.integrity': state === 'same' || state === 'badrepo' ? 'sha512-tested' : 'sha512-different',
  'repository.url': state === 'badrepo' ? 'git+https://github.com/example/other.git' : 'git+https://github.com/timlaing/opencode-tunnel-switch.git',
}));
`, { mode: 0o755 });
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), TEST_NPM_LOG: log,
        TEST_NPM_NPMJS: expected.npmjs, TEST_NPM_GH: expected.gh,
      };
      delete env.GITHUB_ACTIONS;
      const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8", input: manifest, env });
      const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      if (expected.status === 0) assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
      const publishes = calls.filter((args) => args[0] === "publish");
      assert.equal(publishes.length, expected.publishes, result.stderr);
      if (expected.publishes === 2) {
        const [npmjs, github] = publishes;
        for (const [target, args] of [["https://registry.npmjs.org", npmjs], ["https://npm.pkg.github.com", github]] as const) {
          assert.ok(args.includes(`--registry=${target}`), `${target} publish must set --registry`);
          // The scope override outranks a ~/.npmrc @timlaing:registry mapping
          // that would otherwise silently redirect the scoped publish.
          assert.ok(args.includes(`--@timlaing:registry=${target}`), `${target} publish must pin the scope registry`);
        }
        assert.ok(npmjs.includes("--access=public"));
        assert.ok(github.includes("--access=restricted"));
        assert.ok(!npmjs.includes("--provenance"), "provenance is CI-only");
        // Each upload must carry the exact tested tarball. Compare against the
        // real path: the child's cwd() is symlink-resolved (/var -> /private/var).
        const archive = path.join(realpathSync(directory), "package.tgz");
        assert.ok(publishes.every((args) => args.includes(archive)), `each publish must upload ${archive}`);
      }
      // Every registry is probed before any upload happens, always against the
      // packed spec and the registry-matching scope override.
      const spec = "@timlaing/opencode-tunnel-switch@0.1.0";
      const views = calls.filter((args) => args[0] === "view");
      assert.ok(views.every((args) => args.includes(spec)), "each probe must query the packed name@version");
      assert.ok(views.every((args) => args.includes("--registry=https://registry.npmjs.org") && args.includes("--@timlaing:registry=https://registry.npmjs.org")
        || args.includes("--registry=https://npm.pkg.github.com") && args.includes("--@timlaing:registry=https://npm.pkg.github.com")));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("npm provenance is requested only for the npm registry in CI", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-provenance-test-"));
  const log = path.join(directory, "calls.jsonl");
  const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.0", filename: "package.tgz", integrity: "sha512-tested" }]);
  writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'publish') process.exit(0);
console.log(JSON.stringify({ error: { code: 'E404' } }));
process.exit(1);
`, { mode: 0o755 });
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: directory, encoding: "utf8", input: manifest,
      env: { ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), TEST_NPM_LOG: log, GITHUB_ACTIONS: "true" },
    });
    assert.equal(result.status, 0, result.stderr);
    const publishes = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]).filter((args) => args[0] === "publish");
    assert.equal(publishes.length, 2);
    assert.ok(publishes[0].includes("--provenance") && publishes[0].includes("--registry=https://registry.npmjs.org"));
    // The second upload must actually target GitHub Packages.
    assert.ok(publishes[1].includes("--registry=https://npm.pkg.github.com"));
    assert.ok(publishes[1].includes("--@timlaing:registry=https://npm.pkg.github.com"));
    assert.ok(!publishes[1].includes("--provenance"), "GitHub Packages does not accept provenance");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const verifyScript = fileURLToPath(new URL("../scripts/verify-published-package.mjs", import.meta.url));
for (const scenario of ["valid", "wrong-integrity", "wrong-repository", "wrong-version", "missing-attestation"] as const) {
  test(`registry readback rejects invalid metadata: ${scenario}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-readback-test-"));
    const log = path.join(directory, "calls.jsonl");
    const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.1", integrity: "sha512-tested" }]);
    const published = {
      name: "@timlaing/opencode-tunnel-switch",
      version: scenario === "wrong-version" ? "9.9.9" : "0.1.1",
      dist: {
        integrity: scenario === "wrong-integrity" ? "sha512-other" : "sha512-tested",
        // npm releases must carry provenance; the missing-attestation case omits it.
        ...(scenario === "missing-attestation" ? {} : {
          attestations: {
            url: "https://registry.npmjs.org/-/npm/v1/attestations/@timlaing/opencode-tunnel-switch@0.1.1",
            provenance: { predicateType: "https://slsa.dev/provenance/v1" },
          },
        }),
      },
      repository: { url: scenario === "wrong-repository" ? "git+https://github.com/example/other.git" : "git+https://github.com/timlaing/opencode-tunnel-switch.git" },
    };
    writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
const mode = process.env.TEST_NPM_READBACK;
if (mode) {
  let n = 0;
  try { n = Number(fs.readFileSync(process.env.TEST_NPM_COUNT, 'utf8') || 0); } catch {}
  fs.writeFileSync(process.env.TEST_NPM_COUNT, String(n + 1));
  if (mode === 'always-404' || (mode === 'flaky' && n === 0)) {
    console.log(JSON.stringify({ error: { code: 'E404' } }));
    process.exit(1);
  }
}
console.log(${JSON.stringify(JSON.stringify(published))});
`, { mode: 0o755 });
    try {
      const result = spawnSync(process.execPath, [verifyScript], { encoding: "utf8", input: manifest, env: { ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"), TEST_NPM_LOG: log } });
      if (scenario === "valid") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0);
      if (scenario === "missing-attestation") assert.match(result.stderr, /no signed provenance attestation/);
      // A valid readback must reach both registries in separate view calls,
      // each querying the packed spec with its own registry's exact scope
      // override; invalid metadata stops at the first registry.
      const views = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      const spec = "@timlaing/opencode-tunnel-switch@0.1.1";
      assert.ok(views.every((args) => args.includes(spec)), `every readback must query ${spec}`);
      if (scenario === "valid") {
        assert.equal(views.length, 2, "expected one view call per registry");
        assert.ok(views[0].includes("--registry=https://registry.npmjs.org") && !views[0].includes("--registry=https://npm.pkg.github.com"));
        assert.ok(views[0].includes("--@timlaing:registry=https://registry.npmjs.org"), "npm readback must pin the scope registry to npm");
        assert.ok(views[1].includes("--registry=https://npm.pkg.github.com") && !views[1].includes("--registry=https://registry.npmjs.org"));
        assert.ok(views[1].includes("--@timlaing:registry=https://npm.pkg.github.com"), "GitHub readback must pin the scope registry to GitHub Packages");
      } else assert.equal(views.length, 1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("readback retries transient propagation failures for a bounded period", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-readback-retry-test-"));
  const log = path.join(directory, "calls.jsonl");
  const count = path.join(directory, "count");
  const manifest = JSON.stringify([{ name: "@timlaing/opencode-tunnel-switch", version: "0.1.1", integrity: "sha512-tested" }]);
  const published = {
    name: "@timlaing/opencode-tunnel-switch",
    version: "0.1.1",
    dist: {
      integrity: "sha512-tested",
      attestations: { url: "https://registry.npmjs.org/-/npm/v1/attestations/@timlaing/opencode-tunnel-switch@0.1.1" },
    },
    repository: { url: "git+https://github.com/timlaing/opencode-tunnel-switch.git" },
  };
  writeFileSync(path.join(directory, "npm-cli.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NPM_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
let n = 0;
try { n = Number(fs.readFileSync(process.env.TEST_NPM_COUNT, 'utf8') || 0); } catch {}
fs.writeFileSync(process.env.TEST_NPM_COUNT, String(n + 1));
if (process.env.TEST_NPM_READBACK === 'always-404' || (process.env.TEST_NPM_READBACK === 'flaky' && n === 0)) {
  console.log(JSON.stringify({ error: { code: 'E404' } }));
  process.exit(1);
}
console.log(${JSON.stringify(JSON.stringify(published))});
`, { mode: 0o755 });
  const run = (mode: string, attempts = "3") => spawnSync(process.execPath, [verifyScript], {
    encoding: "utf8", input: manifest,
    env: {
      ...process.env, PATH: "/nonexistent", npm_execpath: path.join(directory, "npm-cli.cjs"),
      TEST_NPM_LOG: log, TEST_NPM_COUNT: count, TEST_NPM_READBACK: mode,
      VERIFY_ATTEMPTS: attempts, VERIFY_RETRY_DELAY_MS: "0",
    },
  });
  const views = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  try {
    // First registry 404s once then propagates; second reads back first try.
    const flaky = run("flaky");
    assert.equal(flaky.status, 0, flaky.stderr);
    assert.equal(views().length, 3, "one retry on the first registry, one readback on the second");
    rmSync(log); rmSync(count);
    // A persistent 404 must stop after the configured attempt bound.
    const persistent = run("always-404");
    assert.notEqual(persistent.status, 0);
    assert.match(persistent.stderr, /after 3 attempt/);
    assert.equal(views().length, 3, "retries must be bounded by VERIFY_ATTEMPTS");
    rmSync(log); rmSync(count);
    // An invalid VERIFY_ATTEMPTS must fall back to the default bound
    // (5), never loop past it: NaN === NaN would otherwise never match.
    const invalid = run("always-404", "not-a-number");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /after 5 attempt/);
    assert.equal(views().length, 5, "an invalid bound must fall back to 5 attempts");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

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
    dist: {
      integrity: "sha512-tested",
      attestations: { url: "https://registry.npmjs.org/-/npm/v1/attestations/@timlaing/opencode-tunnel-switch@0.1.1" },
    },
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
