import path from "node:path";
import { spawnSync } from "node:child_process";

/** Run the npm CLI selected by the parent npm run, without searching PATH. */
export function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli))
    throw new Error("Run this tool through its npm run command so npm_execpath is absolute");
  return spawnSync(process.execPath, [cli, ...args], options);
}
