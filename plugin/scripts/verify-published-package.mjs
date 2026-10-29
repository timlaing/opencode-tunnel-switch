import { assertPublishedMatches, readPackFromStdin, readPublishedVersion, retrySettings, targetRegistries } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();

// A freshly published version can lag on a registry's read path, so the
// shared reader retries transient failures for a bounded period instead of
// failing a successful upload.
const settings = retrySettings();

for (const { registry, provenance } of targetRegistries) {
  const published = readPublishedVersion(registry, pack, settings);
  assertPublishedMatches(pack, published, registry, provenance);
}
console.log(`${pack.name}@${pack.version}: published version, repository and tested archive integrity verified on both registries.`);
