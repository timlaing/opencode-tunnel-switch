import path from "node:path";
import { expectedRepositoryUrl, readPackFromStdin, registryArgs, runNpm, targetRegistries } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();

// Probe every registry before uploading to any. Published versions are
// immutable, so a version that lands on one registry with contents the other
// registry cannot match can never be repaired — only a version bump can. A
// mismatch or an unreadable registry therefore aborts before any upload.
const targets = targetRegistries.map(({ registry, access, provenance }) => {
  const args = registryArgs(registry, pack.name);
  const result = runNpm(["view", `${pack.name}@${pack.version}`, "dist.integrity", "repository.url", "--json", ...args], { encoding: "utf8" });
  if (result.status === 0) {
    // npm can exit 0 with empty output when the package exists but the
    // queried version does not; treat that as a missing version rather than
    // letting JSON.parse throw before either registry is probed.
    if (!result.stdout.trim())
      return { registry, access, provenance, args, integrity: null, repository: null };
    const existing = JSON.parse(result.stdout);
    return { registry, access, provenance, args, integrity: existing["dist.integrity"], repository: existing["repository.url"] };
  }
  let error;
  try { error = JSON.parse(result.stdout).error; } catch {}
  if (error?.code !== "E404")
    throw new Error(`Cannot determine whether the package version exists on ${registry}; check registry authentication and connectivity.`);
  return { registry, access, provenance, args, integrity: null, repository: null };
});

for (const { registry, integrity, repository } of targets) {
  if (integrity === null) continue;
  if (integrity !== pack.integrity)
    throw new Error(`This version already exists on ${registry} with different contents. Bump the package version before publishing.`);
  if (repository !== expectedRepositoryUrl)
    throw new Error(`This version already exists on ${registry} with unexpected repository metadata (${repository}); refusing to publish a partially inconsistent release.`);
  console.log(`${pack.name}@${pack.version} already exists on ${registry} with the verified archive integrity; no upload required.`);
}

// Every registry is either already consistent or missing the version; upload.
// A rerun after a partial failure converges: published registries are skipped
// on their integrity match and the missing one is retried.
for (const { registry, access, provenance, args, integrity } of targets) {
  if (integrity !== null) continue;
  // --provenance is CI-only (it needs the Actions OIDC token) and npmjs-only
  // (GitHub Packages does not accept provenance attestations).
  const attest = provenance && process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : [];
  // Capture the upload output instead of inheriting: the staged-version
  // conflict below is only recognisable from npm's error text, so the
  // notices are replayed here to keep the CI log intact.
  const upload = runNpm(["publish", path.resolve(pack.filename), `--access=${access}`, ...attest, ...args], { encoding: "utf8" });
  if (upload.stdout) process.stdout.write(upload.stdout);
  if (upload.stderr) process.stderr.write(upload.stderr);
  if (upload.status === 0) continue;
  // npm accepts a publish into a staging area and only later exposes the
  // version on the read path. A rerun inside that window probes the version
  // as missing (E404 or an empty view) and re-uploads, which npm rejects
  // with E409 for the version it already staged — the earlier upload is in
  // flight, not failed. Treat it as "upload not required": the readback step
  // verifies integrity, repository metadata and attestation once propagation
  // completes, exactly as for a probe match. Any other upload failure still
  // aborts before the remaining registries are touched.
  if (/E409/.test(upload.stderr) && /previously staged version/.test(upload.stderr)) {
    console.log(`${pack.name}@${pack.version} is already staged on ${registry} by an earlier publish attempt; the readback verifies it once the registry exposes it.`);
    continue;
  }
  throw new Error(`Package upload to ${registry} failed`);
}
