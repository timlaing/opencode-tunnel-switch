import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
export function runNpm(args: string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
