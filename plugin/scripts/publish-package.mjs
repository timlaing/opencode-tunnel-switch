import path from "node:path";
import { assertPublishedMatches, expectedRepositoryUrl, readPackFromStdin, readPublishedVersion, registryArgs, retrySettings, runNpm, targetRegistries, terminalStdio } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();

// Probe every registry before uploading to any. Published versions are
// immutable, so a version that lands on one registry with contents the other
// registry cannot match can never be repaired — only a version bump can. A
// mismatch, a missing attestation or an unreadable registry therefore aborts
// before any upload. npm projects field paths client-side, so a version
// without attestations simply lacks the dist.attestations.url key (exit 0).
const targets = targetRegistries.map(({ registry, access, provenance }) => {
  const args = registryArgs(registry, pack.name);
  const result = runNpm(["view", `${pack.name}@${pack.version}`, "dist.integrity", "repository.url", "dist.attestations.url", "--json", ...args], { encoding: "utf8" });
  if (result.status === 0) {
    // npm can exit 0 with empty output when the package exists but the
    // queried version does not; treat that as a missing version rather than
    // letting JSON.parse throw before either registry is probed.
    if (!result.stdout.trim())
      return { registry, access, provenance, args, integrity: null, repository: null, attestation: null };
    const existing = JSON.parse(result.stdout);
    return { registry, access, provenance, args, integrity: existing["dist.integrity"], repository: existing["repository.url"], attestation: existing["dist.attestations.url"] };
  }
  let error;
  try { error = JSON.parse(result.stdout).error; } catch {}
  if (error?.code !== "E404")
    throw new Error(`Cannot determine whether the package version exists on ${registry}; check registry authentication and connectivity.`);
  return { registry, access, provenance, args, integrity: null, repository: null, attestation: null };
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
// The staged-version conflict below is only recognisable from npm's error
// text, so a non-interactive run (CI, where OIDC trusted publishing needs no
// prompt) captures the upload output and replays it — while a maintainer
// publishing from a terminal keeps npm's stdio on that terminal so npm can
// prompt for an OTP or a login.
const terminal = terminalStdio();
const stagedRetry = retrySettings();
for (const { registry, access, provenance, args, integrity } of targets) {
  if (integrity !== null) continue;
  // --provenance is CI-only (it needs the Actions OIDC token) and npmjs-only
  // (GitHub Packages does not accept provenance attestations).
  const attest = provenance && process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : [];
  const upload = runNpm(["publish", path.resolve(pack.filename), `--access=${access}`, ...attest, ...args], terminal ?? { encoding: "utf8" });
  if (!terminal) {
    if (upload.stdout) process.stdout.write(upload.stdout);
    if (upload.stderr) process.stderr.write(upload.stderr);
  }
  if (upload.status === 0) continue;
  // npm accepts a publish into a staging area and only later exposes the
  // version on the read path. A rerun inside that window probes the version
  // as missing (E404 or an empty view) and re-uploads, which npm rejects
  // with E409 for the version it already staged — the earlier upload is in
  // flight, not failed. Published versions are immutable, so before any
  // remaining registry receives its own unretractable upload, wait for the
  // staged version to surface (bounded by the same retry settings as the
  // readback) and verify it against the tested artifact: integrity,
  // repository linkage and the provenance attestation. A mismatch, or a
  // version that stays unreadable past the bound, aborts here exactly like
  // the probe mismatch above. Any other upload failure aborts too.
  if (!terminal && /E409/.test(upload.stderr) && /previously staged version/.test(upload.stderr)) {
    console.log(`${pack.name}@${pack.version} is already staged on ${registry} by an earlier publish attempt; verifying it against the tested artifact before uploading to the remaining registries.`);
    const published = readPublishedVersion(registry, pack, stagedRetry);
    assertPublishedMatches(pack, published, registry, provenance);
    console.log(`${pack.name}@${pack.version} on ${registry} matches the tested archive; no upload required.`);
    continue;
  }
  throw new Error(`Package upload to ${registry} failed`);
}
