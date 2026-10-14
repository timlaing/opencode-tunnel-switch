import type { OptionsType } from "./client.js";

const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] as const;
type Variables = Partial<Record<typeof keys[number], string>>;
type Lease = { proxy: string; bypass: string[] };
type State = { baseline: Variables; applied: Variables; leases: Lease[] };
const states = new WeakMap<NodeJS.ProcessEnv, State>();

function values(state: State): Variables {
  const top = state.leases.at(-1);
  if (!top) return state.baseline;
  const bypass = new Set([
    ...(state.baseline.NO_PROXY ?? "").split(/[\s,]+/),
    ...(state.baseline.no_proxy ?? "").split(/[\s,]+/),
    ...state.leases.flatMap((lease) => lease.bypass),
  ].filter(Boolean));
  return Object.fromEntries(keys.map((key) => [key,
    key.toLowerCase() === "no_proxy" ? [...bypass].join(",") : top.proxy]));
}

/** Leases prevent unloading one project plugin from breaking another in the same process. */
export function configureProcessProxy(options: Omit<OptionsType, "proxyPort"> & { proxyPort: number }, environment: NodeJS.ProcessEnv = process.env): () => void {
  if (!options.configureProxy) return () => {};
  let state = states.get(environment);
  if (!state) {
    const baseline = Object.fromEntries(keys.map((key) => [key, environment[key]]));
    state = { baseline, applied: baseline, leases: [] };
    states.set(environment, state);
  }
  const ip = options.proxyIp ?? options.apiIp;
  const host = ip.includes(":") ? `[${ip}]` : ip;
  const lease: Lease = {
    proxy: `http://${host}:${options.proxyPort}`,
    bypass: ["localhost", "127.0.0.1", "::1", options.apiIp, ...options.noProxy],
  };
  state.leases.push(lease);
  state.applied = values(state);
  for (const key of keys) environment[key] = state.applied[key];
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const previous = state.applied;
    state.leases.splice(state.leases.indexOf(lease), 1);
    const next = values(state);
    for (const key of keys) {
      // Preserve changes made by another component after we configured the environment.
      if (environment[key] !== previous[key]) continue;
      if (next[key] === undefined) delete environment[key];
      else environment[key] = next[key];
    }
    state.applied = next;
    if (!state.leases.length) states.delete(environment);
  };
}
