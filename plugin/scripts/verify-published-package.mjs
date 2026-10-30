import { assertPublishedMatches, readPackFromStdin, readPublishedVersion, retrySettings, createDeadlineSettings, targetRegistries } from "./npm-cli.mjs";

const [pack] = readPackFromStdin();
const baseSettings = retrySettings();

// Verify step uses the remaining job time passed from the publish step.
// If not provided (standalone run), fall back to 7-minute budget.
const jobDeadlineMs = Number.parseInt(process.env.VERIFY_JOB_DEADLINE_MS ?? "", 10);
const verifyBudgetMs = Number.isFinite(jobDeadlineMs) && jobDeadlineMs > 0 
  ? Math.max(0, jobDeadlineMs - Date.now()) 
  : 7 * 60 * 1000; // 7 minutes fallback

const verifyStart = Date.now();
const verifySettings = createDeadlineSettings(baseSettings, verifyStart, verifyBudgetMs);

for (const { registry, provenance } of targetRegistries) {
  // Reserve 1 minute for the other registry's read
  const reservedMs = 60000;
  const published = readPublishedVersion(registry, pack, verifySettings, reservedMs);
  assertPublishedMatches(pack, published, registry, provenance);
}
console.log(`${pack.name}@${pack.version}: published version, repository and tested archive integrity verified on both registries.`);