import { Plugin } from "@opencode/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";
import { createSignal } from "solid-js";
import { Options, makeClient } from "./client.js";
import { uptime, watchStatus, type TunnelStatus } from "./status.js";

export default Plugin.define({
  id: "tunnel-switch",
  /** Add a read-only sidebar with bounded serial polling and disposal cleanup. */
  setup(ctx) {
    const options = Options.parse(ctx.options);
    const client = makeClient(options, options.apiToken);
    const [snapshot, setSnapshot] = createSignal<{
      status?: TunnelStatus; available: boolean; checked?: number;
    }>({ available: false });
    const watcher = watchStatus(client.status, options, (status, available, checked) => {
      setSnapshot({ status, available, checked });
    });
    let removeSlot: (() => void) | undefined;
    try {
      removeSlot = ctx.ui.slot({
        append: "sidebar.content",
        render: () => jsx("box", {
          flexDirection: "column", marginTop: 1,
          get children() { return [
            jsx("text", { fg: ctx.theme.text.base, children: "Tunnel" }),
            jsx("text", { fg: ctx.theme.text.muted, get children() {
              const { status, available, checked } = snapshot();
              if (!checked) return "Checking status…";
              const availability = available ? "API reachable" : "API unavailable · stale";
              const lines = [availability];
              if (status) lines.push(
                `State: ${status.state}${available ? "" : " (last known)"}`,
                `Server: ${status.server ?? "—"}`,
                `ID: ${status.connection_id ?? "—"}`,
                `Started: ${status.started_at ?? "—"}`,
                `Uptime: ${uptime(status.started_at, checked)}${available ? "" : " (at last check)"}`,
                `Proxy: ${status.proxy}`,
              );
              lines.push(`Checked: ${new Date(checked).toLocaleTimeString()}`);
              return lines.join("\n");
            } }),
          ]; },
        }),
      });
      ctx.keymap.layer(() => ({
        mode: "global",
        commands: [{
          id: "tunnel-switch.refresh", title: "Refresh tunnel status", group: "Tunnel",
          palette: true, slash: { name: "tunnel-refresh" },
          run: async () => { await watcher.refresh(); },
        }],
      }));
    } catch (error) {
      watcher.stop();
      removeSlot?.();
      throw error;
    }
    return () => { watcher.stop(); removeSlot?.(); };
  },
});
