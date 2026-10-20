import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Run the npm CLI selected by the parent npm run, without searching PATH.
 * npm's CLI is only guaranteed under Node, so prefer the Node binary npm
 * records in npm_node_execpath over whichever runtime is executing this
 * script (Node for the publish scripts, Bun for verify:package). */
export function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli))
    throw new Error("Run this tool through its npm run command so npm_execpath is absolute");
  const node = process.env.npm_node_execpath;
  return spawnSync(node && path.isAbsolute(node) ? node : process.execPath, [cli, ...args], options);
}

/** npm resolves a scope's registry from the `@scope:registry` config before
 * the plain `--registry` flag, so a maintainer's `~/.npmrc` scope mapping
 * silently redirects scoped publishes to the mapped registry. Force the
 * target by passing both flags whenever the package is scoped. */
export function registryArgs(registry, name) {
  const scope = name.startsWith("@") ? name.slice(0, name.indexOf("/")) : null;
  return scope
    ? [`--registry=${registry}`, `--${scope}:registry=${registry}`]
    : [`--registry=${registry}`];
}

/** The same verified tarball is published to both public registries. npm is
 * the consumer-facing registry (OIDC trusted publishing in CI); GitHub
 * Packages remains available for installs authenticated with a GitHub token. */
export const targetRegistries = [
  { registry: "https://registry.npmjs.org", access: "public", provenance: true },
  { registry: "https://npm.pkg.github.com", access: "restricted", provenance: false },
];

/** Both the preflight and the readback require published versions to be
 * linked to this repository. */
export const expectedRepositoryUrl = "git+https://github.com/timlaing/opencode-tunnel-switch.git";

/** Read pack-metadata JSON from stdin, failing fast when the tool is invoked
 * the old way (with a manifest path argument) or with a terminal on stdin
 * instead of blocking or surfacing an unrelated JSON parse error. */
export function readPackFromStdin() {
  const stale = process.argv[2];
  if (stale)
    throw new Error(`This tool reads pack JSON from stdin; the manifest path argument was removed. `
      + `Drop "${stale}" and pipe the "npm pack --json" output instead (e.g. "npm run verify:package < pack.json").`);
  if (process.stdin.isTTY)
    throw new Error(`This tool reads pack JSON from stdin, but stdin is a terminal. `
      + `Pipe the pack metadata instead (e.g. "npm run verify:package < pack.json").`);
  return JSON.parse(fs.readFileSync(0, "utf8"));
}
