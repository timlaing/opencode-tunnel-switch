import fs from "node:fs";
import { spawnSync } from "node:child_process";

const [pack] = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const result = spawnSync("npm", ["view", `${pack.name}@${pack.version}`, "--json", "--registry=https://npm.pkg.github.com"], { encoding: "utf8" });
if (result.status !== 0) throw new Error("Cannot read back the published package from GitHub Packages");
const published = JSON.parse(result.stdout);
if (published.name !== pack.name || published.version !== pack.version || published.dist?.integrity !== pack.integrity)
  throw new Error("Published package identity or archive integrity does not match the tested artifact");
if (published.repository?.url !== "git+https://github.com/timlaing/opencode-tunnel-switch.git")
  throw new Error("Published package is not linked to the expected repository");
console.log(`${published.name}@${published.version}: published version, repository and tested archive integrity verified.`);
