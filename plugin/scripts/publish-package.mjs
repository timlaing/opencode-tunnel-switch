import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [pack] = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const registry = "https://npm.pkg.github.com";
const result = spawnSync("npm", ["view", `${pack.name}@${pack.version}`, "dist.integrity", "--json", `--registry=${registry}`], { encoding: "utf8" });
if (result.status === 0) {
  const integrity = JSON.parse(result.stdout);
  if (integrity !== pack.integrity)
    throw new Error("This version already exists with different contents. Bump the package version before publishing.");
  console.log(`${pack.name}@${pack.version} already exists with the verified archive integrity; no upload required.`);
} else {
  let error;
  try { error = JSON.parse(result.stdout).error; } catch {}
  if (error?.code !== "E404")
    throw new Error("Cannot determine whether the package version exists; check registry authentication and connectivity.");
  const upload = spawnSync("npm", ["publish", path.resolve(pack.filename), `--registry=${registry}`, "--access=restricted"], { stdio: "inherit" });
  if (upload.status !== 0) throw new Error("Package upload failed");
}
