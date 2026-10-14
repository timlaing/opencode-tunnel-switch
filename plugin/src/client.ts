import { z } from "zod";

export const Options = z.object({
  apiIp: z.union([z.ipv4(), z.ipv6()]).default("127.0.0.1"),
  apiPort: z.number().int().min(1).max(65535).default(8765),
  apiScheme: z.enum(["http", "https"]).default("http"),
  apiToken: z.string().min(1).refine((token) => token.trim().length > 0, "apiToken must not be blank"),
  configureProxy: z.boolean().default(true),
  proxyIp: z.union([z.ipv4(), z.ipv6()]).optional(),
  proxyPort: z.number().int().min(1).max(65535).optional(),
  noProxy: z.array(z.string().min(1)).default([]),
  providers: z.array(z.string().min(1)).min(1).default(["opencode"]),
  patterns: z.array(z.string().min(1)).min(1).default([
    "FreeUsageLimitError", "free usage exceeded", "rate limit exceeded\\. please try again later",
  ]),
  timeoutMs: z.number().int().positive().default(25000),
  cooldownMs: z.number().int().nonnegative().default(30000),
}).strict();

export type OptionsType = z.infer<typeof Options>;
export type Failure = { type: string; message: string; status?: number };
export class RotationRateLimit extends Error {
  /** Carry the wait before retrying work, without requesting another rotation. */
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
  }
}
export function detector(options: OptionsType) {
  const patterns = options.patterns.map((pattern) => new RegExp(pattern, "i"));
  return (provider: string, error: Failure) => options.providers.includes(provider)
    && (error.status === undefined || [402, 403, 429].includes(error.status))
    && patterns.some((pattern) => pattern.test(`${error.type}: ${error.message}`));
}

/** Create an authenticated control client with shared rotation requests and cooldowns. */
export function makeClient(options: OptionsType, token: string, fetcher: typeof fetch = fetch) {
  const host = options.apiIp.includes(":") ? `[${options.apiIp}]` : options.apiIp;
  const base = new URL(`${options.apiScheme}://${host}:${options.apiPort}/`);
  let pending: Promise<string> | undefined;
  let lastRotation = -Infinity;
  /** Call the control API directly and expose 429 retry delays to the work retry hook. */
  async function call(path: string, method: string) {
    const init: RequestInit & { proxy: false } = {
      // Bun fetch must reach the control API even while the SSH tunnel is down.
      proxy: false,
      method, headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(options.timeoutMs), redirect: "error",
    };
    const response = await fetcher(new URL(path, base), init);
    if (!response.ok) {
      const message = `Tunnel API ${response.status}: ${await response.text()}`;
      if (response.status === 429) {
        const header = response.headers.get("Retry-After");
        const seconds = header !== null && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
        const deadline = header === null ? NaN : Date.parse(header);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : deadline - Date.now();
        throw new RotationRateLimit(message, Number.isFinite(delay) ? Math.max(1000, delay) : Math.max(1000, options.cooldownMs));
      }
      throw new Error(message);
    }
    return await response.text();
  }
  return {
    status: () => call("status", "GET"),
    /** Attempt one rotation, sharing in-flight calls and reporting remaining cooldowns. */
    rotate: () => {
      if (pending) return pending;
      const remaining = options.cooldownMs - (Date.now() - lastRotation);
      if (remaining > 0) return Promise.reject(new RotationRateLimit("Tunnel rotation cooldown active", remaining));
      lastRotation = Date.now();
      pending = call("rotate", "POST").finally(() => { pending = undefined; });
      return pending;
    },
  };
}
