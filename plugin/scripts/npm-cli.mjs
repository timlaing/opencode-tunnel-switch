import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Run the npm CLI selected by the parent npm run, without searching PATH.
 * npm's CLI is only guaranteed under Node, so prefer the Node binary npm
 * records in npm_node_execpath over whichever runtime is executing this
 * script (Node for the publish scripts, Bun for verify:package). */
export function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli))
    throw new Error("Run this tool through its npm run command so npm_execpath is absolute");
  const node = process.env.npm_node_execpath;
  return spawnSync(node && path.isAbsolute(node) ? node : process.execPath, [cli, ...args], options);
}

/** npm resolves a scope's registry from the `@scope:registry` config before
 * the plain `--registry` flag, so a maintainer's `~/.npmrc` scope mapping
 * silently redirects scoped publishes to the mapped registry. Force the
 * target by passing both flags whenever the package is scoped. */
export function registryArgs(registry, name) {
  const scope = name.startsWith("@") ? name.slice(0, name.indexOf("/")) : null;
  return scope
    ? [`--registry=${registry}`, `--${scope}:registry=${registry}`]
    : [`--registry=${registry}`];
}

/** The same verified tarball is published to both public registries. npm is
 * the consumer-facing registry (OIDC trusted publishing in CI); GitHub
 * Packages remains available for installs authenticated with a GitHub token. */
export const targetRegistries = [
  { registry: "https://registry.npmjs.org", access: "public", provenance: true },
  { registry: "https://npm.pkg.github.com", access: "restricted", provenance: false },
];

/** Both the preflight and the readback require published versions to be
 * linked to this repository. */
export const expectedRepositoryUrl = "git+https://github.com/timlaing/opencode-tunnel-switch.git";

/** Bounded-retry settings for registry reads (env-overridable). Both the
 * readback and the publish preflight's staged-version wait honour these.
 * Overrides must be positive (attempts) / non-negative (delay) integers:
 * anything else falls back to the default rather than risking a retry loop
 * whose bound never matches (NaN === NaN is false). */
export function retrySettings() {
  const requestedAttempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? "", 10);
  const attempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 5;
  const requestedDelayMs = Number.parseInt(process.env.VERIFY_RETRY_DELAY_MS ?? "", 10);
  const retryDelayMs = Number.isInteger(requestedDelayMs) && requestedDelayMs >= 0 ? requestedDelayMs : 3000;
  return { attempts, retryDelayMs };
}

/** A freshly published version can lag on a registry's read path (npm stages
 * a publish before exposing it; GitHub Packages reads are eventually
 * consistent), so reads retry transient failures for a bounded period
 * instead of failing a successful upload. Returns the parsed document once
 * a non-empty body is served. */
const transientCodes = new Set(["E404", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"]);
const sleep = (ms) => ms > 0 && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function readPublishedVersion(registry, pack, { attempts, retryDelayMs }) {
  let result;
  for (let attempt = 1; ; attempt++) {
    result = runNpm(["view", `${pack.name}@${pack.version}`, "--json", ...registryArgs(registry, pack.name)], { encoding: "utf8" });
    // npm can exit 0 with empty output while metadata is still propagating;
    // only a non-empty body is a readable readback.
    if (result.status === 0 && result.stdout.trim())
      return JSON.parse(result.stdout);
    let error;
    try { error = JSON.parse(result.stdout).error; } catch {}
    const transient = !error || transientCodes.has(error.code) || /^E5\d\d$/.test(error.code ?? "");
    if (!transient || attempt === attempts)
      throw new Error(`Cannot read back the published package from ${registry} after ${attempt} attempt(s); check registry authentication, propagation and connectivity.`);
    sleep(retryDelayMs);
  }
}

/** Compare a readback against the tested pack. Published versions are
 * immutable, so identity, archive integrity, repository linkage and (for
 * npm) the provenance attestation must match here — before any further
 * upload — or the registries can never be brought back into agreement. */
export function assertPublishedMatches(pack, published, registry, provenance) {
  if (published.name !== pack.name || published.version !== pack.version || published.dist?.integrity !== pack.integrity)
    throw new Error(`Package identity or archive integrity read back from ${registry} does not match the tested artifact`);
  if (published.repository?.url !== expectedRepositoryUrl)
    throw new Error(`Package read back from ${registry} is not linked to the expected repository`);
  // Enforce the provenance promise: a release that reached npm without an
  // attestation (OIDC misconfigured, or a manual upload racing the workflow)
  // must fail here rather than ship unattested. GitHub Packages has no
  // npm-style attestations, hence the provenance gate.
  if (provenance && !published.dist?.attestations?.url)
    throw new Error(`Package read back from ${registry} carries no signed provenance attestation; the npm publish must be attested (requires id-token: write and a configured trusted publisher)`);
}

/** Read pack-metadata JSON from stdin, failing fast when the tool is invoked
 * the old way (with a manifest path argument) or with a terminal on stdin
 * instead of blocking or surfacing an unrelated JSON parse error. */
export function readPackFromStdin() {
  const stale = process.argv[2];
  if (stale)
    throw new Error(`This tool reads pack JSON from stdin; the manifest path argument was removed. `
      + `Drop "${stale}" and pipe the "npm pack --json" output instead (e.g. "npm run verify:package < pack.json").`);
  if (process.stdin.isTTY)
    throw new Error(`This tool reads pack JSON from stdin, but stdin is a terminal. `
      + `Pipe the pack metadata instead (e.g. "npm run verify:package < pack.json").`);
  return JSON.parse(fs.readFileSync(0, "utf8"));
}
