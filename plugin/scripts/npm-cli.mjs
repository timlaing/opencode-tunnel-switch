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
