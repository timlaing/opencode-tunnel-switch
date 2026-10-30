import path from "node:path";
import { assertPublishedMatches, expectedRepositoryUrl, probeVersion, readPackFromStdin, readPublishedVersion, registryArgs, retrySettings, createDeadlineSettings, runNpm, targetRegistries, terminalStdio } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();
const baseSettings = retrySettings();

// Job-wide deadline: 15 minutes from start (BEFORE preflight)
const jobStart = Date.now();
const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const jobDeadline = jobStart + JOB_TIMEOUT_MS;
// Publish step gets 7 minutes (420s) so verify step can also fit in 15m job timeout.
const PUBLISH_STEP_BUDGET_MS = 7 * 60 * 1000; // 7 minutes
const publishStepDeadline = jobStart + PUBLISH_STEP_BUDGET_MS;

// Probe every registry before uploading to any. Published versions are
// immutable, so a version that lands on one registry with contents the other
// registry cannot match can never be repaired — only a version bump can. A
// mismatch, a missing attestation or an unreadable registry therefore aborts
// before any upload. npm projects field paths client-side, so a version
// without attestations simply lacks the dist.attestations.url key (exit 0).
// The shared probe answers a missing version immediately but retries
// transient failures (rate limits, registry hiccups) within the bounded
// budget instead of failing the publish before anything was uploaded.
// Preflight uses the job deadline, reserving time for later phases.
const preflightSettings = createDeadlineSettings(baseSettings, jobStart, JOB_TIMEOUT_MS);
const targets = targetRegistries.map(({ registry, access, provenance }) => {
  // Reserve time for remaining registries' preflight probes (1 min each)
  const remaining = targetRegistries.filter(t => t.registry !== registry).length;
  const reservedMs = remaining * 60000;
  const existing = probeVersion(registry, pack, preflightSettings, reservedMs);
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
// Upload timeout is shared across both registries (total 10 minutes) but also
// bounded by the publish step deadline.
const terminal = terminalStdio();
const uploadDeadline = Math.min(publishStepDeadline, jobStart + 600000); // 10 minutes total for both uploads

// Reserve time for recovery readbacks: 1 minute per registry that needs upload
const registriesNeedingUpload = targets.filter(t => t.integrity === null).length;
const recoveryReservedMs = registriesNeedingUpload * 60000;

for (let i = 0; i < targets.length; i++) {
  const { registry, access, provenance, args, integrity } = targets[i];
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
    // Shared upload timeout: remaining time in the 10-minute budget, bounded by publish step deadline.
    const uploadTimeout = Math.max(1000, Math.min(uploadDeadline, publishStepDeadline) - Date.now());
    // For terminal-backed uploads, merge the calculated timeout into the options
    // so interactive uploads also respect the shared budget.
    const uploadOptions = terminal
      ? { ...terminal, timeout: Math.max(1000, Math.min(uploadTimeout, terminal.timeout ?? Infinity)) }
      : { encoding: "utf8", maxBuffer: 1024 * 1024 * 10, timeout: uploadTimeout };
    const upload = runNpm(["publish", path.resolve(pack.filename), `--access=${access}`, ...attest, ...args], uploadOptions);
    if (!terminal) {
      if (upload.stdout) process.stdout.write(upload.stdout);
      if (upload.stderr) process.stderr.write(upload.stderr);
    }
    if (upload.status === 0) {
      // Upload succeeded: verify via readback BEFORE starting next registry.
      // Reserve time for remaining registries' verification (1 min each).
      const verifyDeadline = Math.min(publishStepDeadline - recoveryReservedMs, Date.now() + baseSettings.perReadBudget);
      const verifySettings = { ...baseSettings, stepDeadline: Math.min(publishStepDeadline, verifyDeadline) };
      
      try {
        const published = readPublishedVersion(registry, pack, verifySettings);
        assertPublishedMatches(pack, published, registry, provenance);
        console.log(`${pack.name}@${pack.version} on ${registry} verified after upload; integrity, repository and attestation confirmed.`);
        continue;
      } catch (error_) {
        throw new Error(`Upload to ${registry} succeeded but readback verification failed; ${error_.message}`);
      }
    }
    
    // Upload failed (or timed out). Check if this is a staged-conflict (npm E409 with "staged" wording).
    // Only staged-conflict is recoverable — other failures (E403, network errors, etc.) remain fatal.
    const stderr = upload.stderr ?? "";
    const isStagedConflict = upload.status !== 0 && 
      stderr.includes("E409") && 
      /Cannot publish over previously staged version/i.test(stderr);
    
    if (!isStagedConflict) {
      // Non-staged failure: wrap and throw immediately — no recovery.
      throw new Error(`Package upload to ${registry} failed with non-staged error; ${stderr.trim() || upload.stdout?.trim() || "unknown error"}`);
    }
    
    // Staged-conflict: fall through to verification readback to confirm the artifact.
  }
  
  // Verification readback for staged-conflict: use publish step deadline, reserve time for recovery of other failed uploads.
  const remainingRegistries = targets.slice(i + 1).filter(t => t.integrity === null).length;
  const verifyReservedMs = remainingRegistries * 60000 + recoveryReservedMs;
  const verifyDeadline = publishStepDeadline - verifyReservedMs;
  const verifySettings = { ...baseSettings, stepDeadline: Math.min(publishStepDeadline, verifyDeadline) };
  
  try {
    const published = readPublishedVersion(registry, pack, verifySettings);
    assertPublishedMatches(pack, published, registry, provenance);
    if (skipUpload) {
      console.log(`${pack.name}@${pack.version} on ${registry} verified via readback (no upload performed outside CI).`);
    } else {
      console.log(`${pack.name}@${pack.version} on ${registry} matches the tested archive after a staged-conflict upload failure; an earlier publish attempt already landed it, no upload required.`);
    }
    continue;
  } catch (error_) {
    throw new Error(`Package upload to ${registry} failed; ${error_.message}`);
  }
}

// Output the absolute job deadline for the verifier step.
console.log(`::set-output name=job-deadline-ms::${jobDeadline}`);