import { z } from "zod";
import type { OptionsType } from "./client.js";

const Status = z.object({
  http_proxy: z.object({
    enabled: z.boolean(),
    ip: z.union([z.ipv4(), z.ipv6()]),
    port: z.number().int().min(1).max(65535),
  }),
});

export function discoverProxy(options: OptionsType, response: string): { proxyIp: string; proxyPort: number } {
  let status: z.infer<typeof Status>;
  try {
    status = Status.parse(JSON.parse(response));
  } catch {
    throw new Error("Proxy discovery failed: /status must contain valid http_proxy enabled, ip and port fields");
  }
  if (!status.http_proxy.enabled)
    throw new Error("Proxy discovery failed: the service HTTP proxy is disabled");
  const bindIp = status.http_proxy.ip;
  const advertisedIp = bindIp === "0.0.0.0" || bindIp === "::" ? options.apiIp : bindIp;
  const proxyIp = options.proxyIp ?? advertisedIp;
  if (proxyIp === "0.0.0.0" || proxyIp === "::")
    throw new Error("Proxy discovery failed: proxyIp must be a reachable address, not a wildcard bind address");
  return { proxyIp, proxyPort: options.proxyPort ?? status.http_proxy.port };
}
