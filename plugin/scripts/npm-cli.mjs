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

/** stdio options for an interactive upload (a maintainer publishing from a
 * terminal), or null when no terminal is attached (CI, piped logs). npm must
 * keep the terminal to prompt for an OTP or a login — but pack JSON arrives
 * on stdin, so stdin itself is never a terminal: the consumed pipe is
 * replaced with the controlling terminal input device (`/dev/tty` on Unix,
 * `CONIN$` on Windows) where one exists. When neither can be opened there is
 * no prompt source at all, so callers fall back to capturing npm's output
 * instead of handing npm the already-consumed stdin pipe (which would read
 * EOF instead of the prompt response). */
export function terminalStdio() {
  if (!process.stderr.isTTY && !process.stdout.isTTY) return null;
  for (const device of ["/dev/tty", "CONIN$"]) {
    try { return { stdio: [fs.openSync(device, "r"), "inherit", "inherit"] }; } catch { /* try the next device */ }
  }
  return null;
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

/** Warn once per retry attempt with registry and error code (no credentials). */
function warnRetry(registry, error) {
  const code = error?.code ?? "unknown";
  console.warn(`Retrying read from ${registry} (attempt failed: ${code})`);
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
 * whose bound never matches (NaN === NaN is false).
 *
 * The returned deadline is computed once here, so every read one script run
 * makes — preflight probes, staged-version verification, readback — shares a
 * single wall-clock budget of twice the configured window (attempts ×
 * retryDelayMs: one window for configured-delay waits, one for
 * Retry-After-driven waits whose hints are capped at 60s per attempt)
 * instead of claiming a fresh window per call. That keeps a fully-retried
 * publish step (220s for the workflow's 11 × 10s) and its verify step (a
 * separate run, another 220s) far inside the 15-minute job timeout; the
 * local 5 × 3s defaults budget 30s per step. A zero-delay configuration
 * (tests, ad-hoc local runs) bounds by attempt count alone. */
export function retrySettings() {
  const requestedAttempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? "", 10);
  const attempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 5;
  const requestedDelayMs = Number.parseInt(process.env.VERIFY_RETRY_DELAY_MS ?? "", 10);
  const retryDelayMs = Number.isInteger(requestedDelayMs) && requestedDelayMs >= 0 ? requestedDelayMs : 3000;
  const deadline = retryDelayMs > 0 ? Date.now() + 2 * attempts * retryDelayMs : Infinity;
  return { attempts, retryDelayMs, deadline };
}

/** A freshly published version can lag on a registry's read path (npm stages
 * a publish before exposing it; GitHub Packages reads are eventually
 * consistent), and a rate-limited read can arrive while it propagates, so
 * reads retry transient failures for a bounded period instead of failing a
 * successful upload. Returns the parsed document once a non-empty body is
 * served. */
const transientCodes = new Set(["E404", "E429", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"]);
const sleep = (ms) => ms > 0 && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** An error is transient only when it carries a known transient code or
 * a 5xx-class code. An undefined/missing error (status 0 with empty
 * stdout) stays transient — npm prints an empty body while metadata
 * propagates. A non-zero exit with no parseable error (malformed
 * output, signal death, etc.) is NOT transient: fail fast. */
const isTransient = (error, status) => {
  if (!error) return status === 0; // empty body on exit 0 = still propagating
  if (transientCodes.has(error.code)) return true;
  return /^E5\d\d$/.test(error.code ?? "");
};

/** When retryDelayMs === 0, hints are ignored entirely (tests, local
 * ad-hoc runs bound by attempt count only). Otherwise honour Retry-After
 * from the body (seconds), capped at 60s per attempt so a hostile hint
 * cannot stall a single attempt; the overall budget is enforced by the
 * caller's deadline. */
const waitMs = (error, retryDelayMs) => {
  if (retryDelayMs === 0) return 0;
  const retryAfter = Number(error?.retryAfter);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : retryDelayMs;
};

/** Run npm view with a per-call timeout derived from the shared deadline.
 * Returns the parsed JSON document once a non-empty body is served. */
export function readPublishedVersion(registry, pack, settings) {
  const { attempts, retryDelayMs, deadline } = settings;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(`Read deadline exceeded for ${registry} after ${attempt - 1} attempt(s)`);
    const result = runNpm(
      ["view", `${pack.name}@${pack.version}`, "--json", ...registryArgs(registry, pack.name)],
      { encoding: "utf8", timeout: Number.isFinite(remaining) ? remaining : undefined }
    );
    // npm can exit 0 with empty output while metadata is still propagating;
    // only a non-empty body is a readable readback.
    if (result.status === 0 && result.stdout.trim())
      return JSON.parse(result.stdout);
    let error;
    try { error = JSON.parse(result.stdout).error; } catch {}
    // spawnSync timeout surfaces as error.code === "ETIMEDOUT" with status=null
    if (result.error?.code === "ETIMEDOUT") error = { code: "ETIMEDOUT" };
    if (!isTransient(error, result.status) || attempt === attempts)
      throw new Error(`Cannot read back the published package from ${registry} after ${attempt} attempt(s); check registry authentication, propagation and connectivity.`);
    warnRetry(registry, error);
    sleep(Math.min(waitMs(error, retryDelayMs), Math.max(0, deadline - Date.now())));
  }
}

/** Preflight probe for one registry: returns the flat-key field document
 * (dist.integrity, repository.url, dist.attestations.url) for an existing
 * version, or null when the version is missing. A missing version (E404 or
 * npm's empty-exit-0 view) answers immediately — it must proceed to upload —
 * while transient failures such as rate limits retry within the same bounded
 * budget and message style as the readback instead of aborting the publish.
 * Non-transient errors (auth, malformed input) still fail fast.
 * An existing version that lacks dist.integrity is treated as incomplete
 * metadata — reject before any upload so an unverifiable artifact never
 * lands. */
export function probeVersion(registry, pack, settings) {
  const { attempts, retryDelayMs, deadline } = settings;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(`Probe deadline exceeded for ${registry} after ${attempt - 1} attempt(s)`);
    const result = runNpm(
      ["view", `${pack.name}@${pack.version}`, "dist.integrity", "repository.url", "dist.attestations.url", "--json", ...registryArgs(registry, pack.name)],
      { encoding: "utf8", timeout: Number.isFinite(remaining) ? remaining : undefined }
    );
    // npm exits 0 with empty output when the package exists but the
    // queried version does not; both empty and E404 mean "missing here".
    if (result.status === 0) {
      if (!result.stdout.trim()) return null;
      const doc = JSON.parse(result.stdout);
      // Version exists but is missing dist.integrity — incomplete metadata;
      // reject before upload so the run never ships an unverifiable artifact.
      if (!doc["dist.integrity"])
        throw new Error(`Package version on ${registry} is missing dist.integrity; incomplete metadata — refusing to upload.`);
      return doc;
    }
    let error;
    try { error = JSON.parse(result.stdout).error; } catch {}
    if (result.error?.code === "ETIMEDOUT") error = { code: "ETIMEDOUT" };
    if (error?.code === "E404")
      return null;
    if (!isTransient(error, result.status) || attempt === attempts)
      throw new Error(`Cannot determine whether the package version exists on ${registry}; check registry authentication and connectivity.`);
    warnRetry(registry, error);
    sleep(Math.min(waitMs(error, retryDelayMs), Math.max(0, deadline - Date.now())));
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
