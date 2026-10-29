import path from "node:path";
import { assertPublishedMatches, expectedRepositoryUrl, probeVersion, readPackFromStdin, readPublishedVersion, registryArgs, retrySettings, runNpm, targetRegistries, terminalStdio } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();
const settings = retrySettings();

// Probe every registry before uploading to any. Published versions are
// immutable, so a version that lands on one registry with contents the other
// registry cannot match can never be repaired — only a version bump can. A
// mismatch, a missing attestation or an unreadable registry therefore aborts
// before any upload. npm projects field paths client-side, so a version
// without attestations simply lacks the dist.attestations.url key (exit 0).
// The shared probe answers a missing version immediately but retries
// transient failures (rate limits, registry hiccups) within the bounded
// budget instead of failing the publish before anything was uploaded.
const targets = targetRegistries.map(({ registry, access, provenance }) => {
  const existing = probeVersion(registry, pack, settings);
  return {
    registry, access, provenance, args: registryArgs(registry, pack.name),
    integrity: existing?.["dist.integrity"] ?? null,
    repository: existing?.["repository.url"] ?? null,
    attestation: existing?.["dist.attestations.url"] ?? null,
  };
});

for (const { registry, provenance, integrity, repository, attestation } of targets) {
  if (integrity === null) continue;
  if (integrity !== pack.integrity)
    throw new Error(`This version already exists on ${registry} with different contents. Bump the package version before publishing.`);
  if (repository !== expectedRepositoryUrl)
    throw new Error(`This version already exists on ${registry} with unexpected repository metadata (${repository}); refusing to publish a partially inconsistent release.`);
  // The same provenance gate as the readback, enforced here as well: a
  // readable version that reached the registry unattested must abort before
  // another registry receives an unretractable upload, not at readback
  // afterwards. Immutable like the rest, so a version bump is the repair.
  if (provenance && !attestation)
    throw new Error(`This version already exists on ${registry} with no signed provenance attestation; the npm publish must be attested (requires id-token: write and a configured trusted publisher). Bump the package version before publishing.`);
  console.log(`${pack.name}@${pack.version} already exists on ${registry} with the verified archive integrity; no upload required.`);
}

// Every registry is either already consistent or missing the version; upload.
// A rerun after a partial failure converges: published registries are skipped
// on their integrity match and the missing one is retried.
// An upload can fail even though this exact artifact already landed: npm
// stages a publish before its read path serves it, GitHub Packages reads are
// eventually consistent, and a probe that ran before the staged version
// surfaced reports "missing". Never classify by npm's error wording or code
// (they differ per registry and per npm version); instead read the failed
// registry back — bounded by the same retry settings as the readback — and
// continue only when it holds the exact tested artifact: integrity,
// repository linkage and the provenance attestation. A mismatch, an
// unattested version or a registry that stays unreadable past the bound
// keeps the failure (wrapped together with the upload error), so no
// remaining registry receives an unretractable upload while another holds
// something unverified.
//
// Outside GitHub Actions, npm uploads require provenance (OIDC). If provenance
// cannot be produced, skip the upload but STILL verify via readback that the
// version is present and attested on npmjs. This prevents an immutable,
// partially verified release.
//
// Upload timeout is shared across both registries (total 10 minutes) so the
// combined upload time stays within the job limit. A stalled interactive
// publish also gets this timeout via terminalStdio().
//
// The entire publish step (preflight + uploads + verifications) is bounded by
// the GitHub Actions job timeout (15 minutes). All readback verifications
// use the step deadline, not a fresh one, so total time stays within limit.
const stepStart = Date.now();
const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const stepDeadline = stepStart + JOB_TIMEOUT_MS;
const terminal = terminalStdio();

// Upload timeout is shared across both registries (total 10 minutes) but also
// bounded by the step deadline.
const uploadDeadline = Math.min(stepDeadline, stepStart + 600000); // 10 minutes

for (const { registry, access, provenance, args, integrity } of targets) {
  if (integrity !== null) continue;
  // Outside GitHub Actions, npm (provenance=true) cannot produce attestation.
  // Skip the upload but STILL verify via readback that the version is present
  // and attested on npmjs. If nothing is staged, the readback will fail.
  const skipUpload = provenance && process.env.GITHUB_ACTIONS !== "true";
  if (skipUpload) {
    console.log(`Skipping npm upload outside GitHub Actions (no OIDC token for provenance); will verify via readback.`);
  }
  // --provenance is CI-only (it needs the Actions OIDC token) and npmjs-only
  // (GitHub Packages does not accept provenance attestations).
  const attest = provenance && process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : [];
  
  if (!skipUpload) {
    // Shared upload timeout: remaining time in the 10-minute budget, bounded by step deadline.
    const uploadTimeout = Math.max(1000, Math.min(uploadDeadline, stepDeadline) - Date.now());
    const uploadOptions = terminal ?? { encoding: "utf8", maxBuffer: 1024 * 1024 * 10, timeout: uploadTimeout };
    const upload = runNpm(["publish", path.resolve(pack.filename), `--access=${access}`, ...attest, ...args], uploadOptions);
    if (!terminal) {
      if (upload.stdout) process.stdout.write(upload.stdout);
      if (upload.stderr) process.stderr.write(upload.stderr);
    }
    if (upload.status === 0) continue;
    // Upload failed (or timed out). Fall through to verification readback.
  }
  
  // Verification readback: use step deadline (not fresh) so total time stays within job limit.
  // Compute per-read budget that reserves time for remaining registries.
  const remainingRegistries = targets.filter(t => t.integrity === null && t.registry !== registry).length;
  const minReservedPerRegistry = 60000; // 1 minute minimum per remaining registry
  const reservedForRemaining = remainingRegistries * minReservedPerRegistry;
  const readDeadline = Math.min(stepDeadline - reservedForRemaining, Date.now() + settings.perReadBudget);
  const verifySettings = { ...settings, stepDeadline: readDeadline };
  
  try {
    const published = readPublishedVersion(registry, pack, verifySettings);
    assertPublishedMatches(pack, published, registry, provenance);
    if (skipUpload) {
      console.log(`${pack.name}@${pack.version} on ${registry} verified via readback (no upload performed outside CI).`);
    } else {
      console.log(`${pack.name}@${pack.version} on ${registry} matches the tested archive after a failed upload; an earlier publish attempt already landed it, no upload required.`);
    }
    continue;
  } catch (error_) {
    throw new Error(`Package upload to ${registry} failed; ${error_.message}`);
  }
}