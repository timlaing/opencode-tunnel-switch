import { expectedRepositoryUrl, readPackFromStdin, registryArgs, runNpm, targetRegistries } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();

// A freshly published version can lag on a registry's read path (GitHub
// Packages reads are eventually consistent), so readback retries transient
// failures for a bounded period instead of failing a successful upload.
// Env overrides must be positive (attempts) / non-negative (delay) integers:
// anything else falls back to the default rather than risking a retry loop
// whose bound never matches (NaN === NaN is false).
const requestedAttempts = Number.parseInt(process.env.VERIFY_ATTEMPTS ?? "", 10);
const attempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 ? requestedAttempts : 5;
const requestedDelayMs = Number.parseInt(process.env.VERIFY_RETRY_DELAY_MS ?? "", 10);
const retryDelayMs = Number.isInteger(requestedDelayMs) && requestedDelayMs >= 0 ? requestedDelayMs : 3000;
const transientCodes = new Set(["E404", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"]);
const sleep = (ms) => ms > 0 && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (const { registry, provenance } of targetRegistries) {
  let result;
  for (let attempt = 1; ; attempt++) {
    result = runNpm(["view", `${pack.name}@${pack.version}`, "--json", ...registryArgs(registry, pack.name)], { encoding: "utf8" });
    if (result.status === 0) break;
    let error;
    try { error = JSON.parse(result.stdout).error; } catch {}
    const transient = !error || transientCodes.has(error.code) || /^E5\d\d$/.test(error.code ?? "");
    if (!transient || attempt === attempts)
      throw new Error(`Cannot read back the published package from ${registry} after ${attempt} attempt(s); check registry authentication, propagation and connectivity.`);
    sleep(retryDelayMs);
  }
  const published = JSON.parse(result.stdout);
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
console.log(`${pack.name}@${pack.version}: published version, repository and tested archive integrity verified on both registries.`);
