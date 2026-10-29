import { assertPublishedMatches, readPackFromStdin, readPublishedVersion, retrySettings, createDeadlineSettings, targetRegistries } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();
const baseSettings = retrySettings();

// Verify step gets the remaining job time (15 minutes total, publish step used some)
// In practice, this is a separate run, so it gets its own 15-minute budget.
// But to be safe, we use a 7-minute budget (matching stepBudget cap).
const verifyStart = Date.now();
const VERIFY_BUDGET_MS = 7 * 60 * 1000; // 7 minutes
const verifySettings = createDeadlineSettings(baseSettings, verifyStart, VERIFY_BUDGET_MS);

for (const { registry, provenance } of targetRegistries) {
  // Reserve 1 minute for the other registry's read
  const reservedMs = 60000;
  const published = readPublishedVersion(registry, pack, verifySettings, reservedMs);
  assertPublishedMatches(pack, published, registry, provenance);
}
console.log(`${pack.name}@${pack.version}: published version, repository and tested archive integrity verified on both registries.`);