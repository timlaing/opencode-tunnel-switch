import { z } from "zod";
import { discoverProxy } from "./discovery.js";
import type { OptionsType } from "./client.js";

const Status = z.object({
  state: z.enum(["connected", "disconnected", "rotating"]),
  connection_id: z.string().nullable(),
  started_at: z.iso.datetime({ offset: true }).nullable(),
  server: z.string().nullable().optional(),
});
export type TunnelStatus = z.infer<typeof Status> & { proxy: string };

/** Validate the server response and display only allowlisted connection fields. */
export function parseStatus(response: string, options: OptionsType): TunnelStatus {
  const raw: unknown = JSON.parse(response);
  const status = Status.parse(raw);
  let proxy = "Disabled";
  const disabled = z.object({ http_proxy: z.object({ enabled: z.literal(false) }) }).safeParse(raw).success;
  if (!disabled) {
    const { proxyIp, proxyPort } = discoverProxy(options, response);
    const host = proxyIp.includes(":") ? `[${proxyIp}]` : proxyIp;
    proxy = `${host}:${proxyPort}`;
  }
  return { ...status, proxy };
}

/** Format elapsed time without reporting negative uptime for clock skew. */
export function uptime(startedAt: string | null, now: number): string {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}

/** Poll serially, retain the last good response on failure, and stop on disposal. */
export function watchStatus(read: () => Promise<string>, options: OptionsType,
  update: (status: TunnelStatus | undefined, available: boolean, checked: number, lastSuccessful: number | undefined) => void,
  intervalMs = 5000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let status: TunnelStatus | undefined;
  let lastSuccessful: number | undefined;
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    clearTimeout(timer);
    pending = (async () => {
      let available = false;
      try {
        status = parseStatus(await read(), options);
        lastSuccessful = Date.now();
        available = true;
      } catch { /* Never display API errors or credentials. */ }
      if (!stopped) update(status, available, Date.now(), lastSuccessful);
    })().finally(() => {
      pending = undefined;
      if (!stopped) timer = setTimeout(() => { void refresh(); }, intervalMs);
    });
    return pending;
  }
  void refresh();
  return { refresh, stop() { stopped = true; clearTimeout(timer); } };
}
