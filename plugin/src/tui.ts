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
    // Follow the MCP sidebar's conventions: <text fg> for whole-line colours,
    // style={{ fg }} on <span> for inline runs (a bare fg prop on a span is
    // silently dropped by the reconciler), theme feedback colours for states.
    const themed = (path: readonly string[], fallback: string): string => {
      let current: unknown = ctx.theme;
      for (const key of path) current = (current as Record<string, unknown> | undefined)?.[key];
      return typeof current === "string" ? current : fallback;
    };
    const base = themed(["text", "base"], "#ffffff");
    const muted = themed(["text", "muted"], "#868895");
    const positive = themed(["text", "feedback", "success", "base"], "#a6e3a1");
    const warning = themed(["text", "feedback", "warning", "base"], "#f9e2af");
    const negative = themed(["text", "feedback", "error", "base"], "#f38ba8");
    // A row: bold title in the theme's base colour, two-space indented and
    // without a colon; value flush right (muted or state-coloured), matching
    // the sibling sidebars' label/value layout.
    const line = (label: string, value: string | (() => string), colour?: string, suffix?: string) =>
      jsx("box", { flexDirection: "row", gap: 1, minWidth: 0, get children() { return [
        jsx("text", { fg: base, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0,
          get children() { return jsx("b", { children: `  ${label}` }); } }),
        jsx("text", { wrapMode: "none", truncate: true, flexShrink: 0, get children() {
          const children = [jsx("span", {
            style: { fg: colour ?? muted },
            get children() { return typeof value === "function" ? value() : value; },
          })];
          if (suffix) children.push(jsx("span", { style: { fg: muted }, children: suffix }));
          return children;
        } }),
      ]; } });
    // Muted summary shown beside "Tunnel" while the sidebar is collapsed,
    // naming the tunnel (its configured server) once one has been reported.
    // The name is capped so a long hostname cannot push the reachability
    // state out of the collapsed header.
    /** Keep a server name within 20 columns, elided with an ellipsis. */
    const clipName = (name: string): string => (name.length <= 20 ? name : `${name.slice(0, 19)}…`);
    const collapsedSummary = (name: string | null | undefined, checked: number | undefined,
      available: boolean): string => {
      let reach: string;
      if (!checked) reach = "checking…";
      else if (available) reach = "reachable";
      else reach = "unavailable";
      if (!name) return ` (${reach})`;
      return ` (${clipName(name)} · ${reach})`;
    };
    // Feedback colour for a tunnel state.
    const stateColour = (state: TunnelStatus["state"]): string => {
      if (state === "connected") return positive;
      if (state === "rotating") return warning;
      return negative;
    };
    const client = makeClient(options, options.apiToken);
    const [snapshot, setSnapshot] = createSignal<{
      status?: TunnelStatus; available: boolean; checked?: number; lastSuccessful?: number;
    }>({ available: false });
    const [clock, setClock] = createSignal(Date.now());
    const [expanded, setExpanded] = createSignal(true);
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
            return jsx("box", { flexDirection: "column", marginTop: 1, get children() {
              const { status, available, checked, lastSuccessful } = snapshot();
              const open = expanded();
              // Collapsible header, toggled by clicking like the MCP sidebar box.
              const header = jsx("box", { flexDirection: "row", gap: 1, onMouseDown: () => setExpanded(!open), get children() { return [
                jsx("text", { fg: base, children: open ? "▼" : "▶" }),
                jsx("text", { fg: base, get children() {
                  const children = [jsx("b", { children: "Tunnel" })];
                  if (!open) children.push(jsx("span", { style: { fg: muted },
                    children: collapsedSummary(status?.server, checked, available) }));
                  return children;
                } }),
              ]; } });
              if (!open) return [header];
              if (!checked) return [header, jsx("text", { fg: muted, children: "Checking status…" })];
              const lines = [
                line("API", available ? "reachable" : "unavailable", available ? positive : negative),
              ];
              if (status) {
                lines.push(
                  line("State", status.state, stateColour(status.state), available ? undefined : " (last known)"),
                  line("Server", status.server ?? "—"),
                  line("Started", formatTimestamp(status.started_at)),
                  line("Uptime", () => uptime(status.started_at, lastSuccessful ?? checked), undefined,
                    available ? undefined : " (at last success)"),
                  line("Proxy", status.proxy),
                );
              }
              // The relative age stays muted (the default value colour) between polls.
              lines.push(line("Checked", () => formatAge(checked, clock()), muted));
              return [header, ...lines];
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
        }, {
          id: "tunnel-switch.toggle", title: "Toggle tunnel sidebar details", group: "Tunnel",
          palette: true, slash: { name: "tunnel-toggle" },
          run: () => { setExpanded(!expanded()); },
        }],
      }));
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  },
});
