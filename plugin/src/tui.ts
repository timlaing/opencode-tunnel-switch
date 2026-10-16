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

/** Format an ISO timestamp as HH:MM:SS DD/MM/YY. */
function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} `
    + `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}`;
}

/** Compact relative age for the last check, e.g. "25s ago" or "2.5hr ago". */
function formatAge(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}hr ago`;
  return `${(seconds / 86400).toFixed(1)}d ago`;
}

/** TextAttributes.BOLD as a raw bitmask; @opentui/core must not be imported. */
const BOLD = 1;

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
    // Labels render white and values grey; API and State colour-code their
    // values with theme semantics when the host exposes them.
    const semantic = (name: string, fallback: string) => {
      const value = (ctx.theme as unknown as Record<string, unknown>)[name];
      return typeof value === "string" ? value : fallback;
    };
    const positive = semantic("success", "#a6e3a1");
    const warning = semantic("warning", "#f9e2af");
    const negative = semantic("error", "#f38ba8");
    const client = makeClient(options, options.apiToken);
    const [snapshot, setSnapshot] = createSignal<{
      status?: TunnelStatus; available: boolean; checked?: number; lastSuccessful?: number;
    }>({ available: false });
    const [clock, setClock] = createSignal(Date.now());
    // Tick once a second so the relative "Checked" age stays live between polls.
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    const watcher = watchStatus(client.status, options, (status, available, checked, lastSuccessful) => {
      setSnapshot({ status, available, checked, lastSuccessful });
    });
    let removeSlot: (() => void) | undefined;
    let warned = false;
    const stop = () => { clearInterval(ticker); watcher.stop(); removeSlot?.(); };
    try {
      removeSlot = ctx.ui.slot({
        append: "sidebar.content",
        render: () => {
          try {
            const heading = () => jsx("text", { fg: ctx.theme.text.base, attributes: BOLD, children: "Tunnel" });
            const line = (label: string, value: string | (() => string), colour?: string) =>
              jsx("text", { get children() { return [
                jsx("span", { fg: ctx.theme.text.base, children: `${label}: ` }),
                jsx("span", { fg: colour ?? ctx.theme.text.muted, get children() { return typeof value === "function" ? value() : value; } }),
              ]; } });
            return jsx("box", { flexDirection: "column", marginTop: 1, get children() {
              const { status, available, checked, lastSuccessful } = snapshot();
              if (!checked) return [heading(), jsx("text", { fg: ctx.theme.text.muted, children: "Checking status…" })];
              const now = clock();
              const lines = [
                heading(),
                line("API", available ? "reachable" : "unavailable", available ? positive : negative),
              ];
              if (status) lines.push(
                line("State", () => `${status.state}${available ? "" : " (last known)"}`,
                  status.state === "connected" ? positive : status.state === "rotating" ? warning : negative),
                line("Server", status.server ?? "—"),
                line("Started", formatTimestamp(status.started_at)),
                line("Uptime", () => `${uptime(status.started_at, lastSuccessful ?? checked)}${available ? "" : " (at last successful check)"}`),
                line("Proxy", status.proxy),
              );
              lines.push(line("Checked", () => formatAge(checked, now)));
              return lines;
            } });
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
      stop();
      throw error;
    }
    return stop;
  },
});
