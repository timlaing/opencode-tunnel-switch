import { Plugin } from "@opencode/plugin/tui";
import { Options, makeClient, type OptionsType } from "./client.js";
import { uptime, watchStatus, type TunnelStatus } from "./status.js";

type JsxRuntime = typeof import("@opentui/solid/jsx-runtime");
type SolidRuntime = typeof import("solid-js");

/**
 * The TUI runtime shares its OpenTUI/Solid singletons with plugins through
 * virtual `opentui:runtime-module:` ids (registered by OpenCode at startup).
 * Importing `@opentui/solid`/`solid-js` directly loads a second renderer
 * instance whose `RendererContext` is never provided, so every slot render
 * throws "No renderer found". Prefer the host ids, then the local packages
 * (test harnesses), then give up.
 */
const runtimeModule = (specifier: string) => `opentui:runtime-module:${encodeURIComponent(specifier)}`;

async function uiRuntime(): Promise<{ readonly jsx: JsxRuntime["jsx"]; readonly createSignal: SolidRuntime["createSignal"] } | undefined> {
  try {
    const [jsxRuntime, solid] = await Promise.all([
      import(runtimeModule("@opentui/solid/jsx-runtime")) as Promise<JsxRuntime>,
      import(runtimeModule("solid-js")) as Promise<SolidRuntime>,
    ]);
    return { jsx: jsxRuntime.jsx, createSignal: solid.createSignal };
  } catch {
    try {
      const [jsxRuntime, solid] = await Promise.all([
        import("@opentui/solid/jsx-runtime"),
        import("solid-js"),
      ]);
      return { jsx: jsxRuntime.jsx, createSignal: solid.createSignal };
    } catch {
      return undefined;
    }
  }
}

export default Plugin.define({
  id: "tunnel-switch",
  /** Add a read-only sidebar with bounded serial polling and disposal cleanup. */
  async setup(ctx) {
    let options: OptionsType;
    try {
      options = Options.parse(ctx.options);
    } catch (error) {
      // OpenCode's TUI runtime only receives options declared in cli.json; options
      // from opencode.json(c) stay server-side, so degrade with actionable guidance.
      const issue = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues?.[0];
      const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : String(error);
      ctx.ui.toast.show({
        variant: "error",
        title: "tunnel-switch: options unavailable",
        message: `${detail} — declare this plugin with its options in cli.json to enable the `
          + "tunnel sidebar.",
        duration: 10000,
      });
      return () => {};
    }
    const ui = await uiRuntime();
    if (!ui) {
      ctx.ui.toast.show({
        variant: "error",
        title: "tunnel-switch: sidebar unavailable",
        message: "Neither the host UI runtime nor a local @opentui/solid install is available; "
          + "the tunnel still rotates through the server plugin.",
        duration: 10000,
      });
      return () => {};
    }
    const { jsx, createSignal } = ui;
    const client = makeClient(options, options.apiToken);
    const [snapshot, setSnapshot] = createSignal<{
      status?: TunnelStatus; available: boolean; checked?: number; lastSuccessful?: number;
    }>({ available: false });
    const watcher = watchStatus(client.status, options, (status, available, checked, lastSuccessful) => {
      setSnapshot({ status, available, checked, lastSuccessful });
    });
    let removeSlot: (() => void) | undefined;
    let warned = false;
    try {
      removeSlot = ctx.ui.slot({
        append: "sidebar.content",
        render: () => {
          try {
            return jsx("box", {
              flexDirection: "column", marginTop: 1,
              get children() { return [
                jsx("text", { fg: ctx.theme.text.base, children: "Tunnel" }),
                jsx("text", { fg: ctx.theme.text.muted, get children() {
                  const { status, available, checked, lastSuccessful } = snapshot();
                  if (!checked) return "Checking status…";
                  const availability = available ? "API reachable" : "API unavailable · stale";
                  const lines = [availability];
                  if (status) lines.push(
                    `State: ${status.state}${available ? "" : " (last known)"}`,
                    `Server: ${status.server ?? "—"}`,
                    `ID: ${status.connection_id ?? "—"}`,
                    `Started: ${status.started_at ?? "—"}`,
                    `Uptime: ${uptime(status.started_at, lastSuccessful ?? checked)}${available ? "" : " (at last successful check)"}`,
                    `Proxy: ${status.proxy}`,
                  );
                  lines.push(`Checked: ${new Date(checked).toLocaleTimeString()}`);
                  return lines.join("\n");
                } }),
              ]; },
            });
          } catch {
            // The local fallback instance cannot render against the host's
            // renderer; degrade once instead of crashing the slot boundary.
            if (!warned) {
              warned = true;
              ctx.ui.toast.show({
                variant: "error",
                title: "tunnel-switch: sidebar unavailable",
                message: "This OpenCode build did not share its UI runtime with the plugin "
                  + "(OpenTUI instance mismatch); the tunnel still rotates server-side.",
                duration: 10000,
              });
            }
            return null;
          }
        },
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
