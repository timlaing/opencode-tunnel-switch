import path from "node:path";
import { assertPublishedMatches, expectedRepositoryUrl, probeVersion, readPackFromStdin, readPublishedVersion, registryArgs, retrySettings, freshRetrySettings, runNpm, targetRegistries, terminalStdio } from "./npm-cli.mjs";

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
// something unverified. This path also works for interactive runs: the
// verification spawns its own captured npm calls, independent of the
// upload's stdio, so a maintainer rerunning from a terminal after npm
// staged the version converges instead of seeing a raw failure.
const terminal = terminalStdio();
for (const { registry, access, provenance, args, integrity } of targets) {
  if (integrity !== null) continue;
  // --provenance is CI-only (it needs the Actions OIDC token) and npmjs-only
  // (GitHub Packages does not accept provenance attestations).
  const attest = provenance && process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : [];
  // A non-interactive run (CI, where OIDC trusted publishing needs no prompt)
  // captures npm's output and replays it for the CI log; a maintainer
  // publishing from a terminal keeps npm's stdio on that terminal so npm can
  // prompt for an OTP or a login. Use a large maxBuffer for captured output
  // so verbose npm logging cannot terminate the upload.
  const uploadOptions = terminal ?? { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }; // 10 MiB
  const upload = runNpm(["publish", path.resolve(pack.filename), `--access=${access}`, ...attest, ...args], uploadOptions);
  if (!terminal) {
    if (upload.stdout) process.stdout.write(upload.stdout);
    if (upload.stderr) process.stderr.write(upload.stderr);
  }
  if (upload.status === 0) continue;
  try {
    // Use a fresh deadline for verification readback so preflight/upload time
    // does not consume the readback budget.
    const verifySettings = freshRetrySettings();
    const published = readPublishedVersion(registry, pack, verifySettings);
    assertPublishedMatches(pack, published, registry, provenance);
    console.log(`${pack.name}@${pack.version} on ${registry} matches the tested archive after a failed upload; an earlier publish attempt already landed it, no upload required.`);
    continue;
  } catch (error_) {
    throw new Error(`Package upload to ${registry} failed; ${error_.message}`);
  }
}
