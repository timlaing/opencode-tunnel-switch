import { parseStatus, type TunnelStatus } from "./status.js";
import type { OptionsType } from "./client.js";

/** Poll /status and rotate when the tunnel reports disconnected, stopping on disposal. */
export function watchConnection(
  read: () => Promise<string>,
  rotate: (reason?: string) => Promise<string>,
  options: OptionsType,
  intervalMs = options.reconnectMs,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    clearTimeout(timer);
    pending = (async () => {
      let state: TunnelStatus["state"] | undefined;
      try {
        state = parseStatus(await read(), options).state;
      } catch { /* Status API failures are not tunnel failures; rotation is impossible without it. */ }
      // The watcher may have been stopped while the read was pending; a
      // disconnected response received after disposal must not rotate.
      if (stopped) return;
      if (state === "disconnected") {
        try {
          await rotate("auto-reconnect: tunnel disconnected");
          console.error("[tunnel-switch] Auto-reconnect: rotated the tunnel after it reported disconnected.");
        } catch (error) {
          console.error(`[tunnel-switch] Auto-reconnect rotation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })().finally(() => {
      pending = undefined;
      if (!stopped) {
        timer = setTimeout(() => { void refresh(); }, intervalMs);
        // A background reconnect poll must not keep the process (or test runner) alive.
        timer.unref();
      }
    });
    return pending;
  }
  void refresh();
  return { refresh, stop() { stopped = true; clearTimeout(timer); } };
}
