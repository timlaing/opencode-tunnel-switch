import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Host } from "@opencode/plugin/host";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: bun scripts/verify-package.ts PACK_JSON_PATH");
const entries = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{
  name: string; filename: string; files: Array<{ path: string }>;
}>;
if (entries.length !== 1 || entries[0].name !== "@timlaing/opencode-tunnel-switch")
  throw new Error("Unexpected package identity");
const pack = entries[0];
const files = pack.files.map((file) => file.path);
for (const required of ["package.json", "README.md", "index.ts", "src/index.ts", "src/client.ts", "src/discovery.ts", "src/environment.ts"])
  if (!files.includes(required)) throw new Error(`Missing packaged file: ${required}`);
for (const file of files)
  if (!["package.json", "README.md", "index.ts"].includes(file) && !/^src\/[a-zA-Z0-9/_-]+\.ts$/.test(file))
    throw new Error(`Unexpected packaged file: ${file}`);
const directory = mkdtempSync(path.join(tmpdir(), "tunnel-switch-packed-"));
try {
  execFileSync("npm", ["install", "--prefix", directory, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", path.resolve(pack.filename)], { stdio: "inherit" });
  const installed = path.join(directory, "node_modules", "@timlaing", "opencode-tunnel-switch");
  const entrypoint = Host.resolve({ directory: installed }).server;
  if (!entrypoint) throw new Error("Packed plugin has no OpenCode server entrypoint");
  const module = await Host.load(entrypoint) as { default?: { id?: string; setup?: unknown } };
  if (module.default?.id !== "tunnel-switch" || typeof module.default.setup !== "function")
    throw new Error("Packed plugin does not expose the expected v2 definition");
  console.log("Packed plugin file allowlist and installed OpenCode entrypoint verified.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
