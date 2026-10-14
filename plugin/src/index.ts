import { Plugin } from "@opencode/plugin";
import { Options, detector, makeClient } from "./client.js";
import { configureProcessProxy } from "./environment.js";
import { discoverProxy } from "./discovery.js";

export default Plugin.define({
  id: "tunnel-switch",
  async setup(ctx) {
    const options = Options.parse(ctx.options);
    const client = makeClient(options, options.apiToken);
    const matches = detector(options);
    let restoreEnvironment = () => {};
    if (options.configureProxy) {
      let status: string;
      try { status = await client.status(); }
      catch (error) {
        throw new Error(`Proxy discovery failed: could not query /status: ${String(error)}`);
      }
      restoreEnvironment = configureProcessProxy({ ...options, ...discoverProxy(options, status) });
    }
    try {
      await ctx.session.hook("retry", async (event) => {
        // Only the first retry opportunity may rotate. OpenCode retains its hard retry limit.
        if (event.attempt > 2 || !matches(event.model.providerID, event.error)) return;
        try {
          const status = await client.rotate();
          event.decision = { retry: true, delay: 1000 };
          await ctx.session.synthetic({ sessionID: event.sessionID, text: `SSH tunnel rotated: ${status}` })
            .catch((error) => console.error("[tunnel-switch] Could not display rotation status", String(error)));
        } catch (error) {
          event.decision = { retry: false };
          console.error(`[tunnel-switch] ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      await ctx.command.transform((editor) => {
        editor.add({
          name: "tunnel-status",
          description: "Display SSH tunnel connection ID and start time",
          execute: async ({ sessionID }) => {
            let text: string;
            try { text = `SSH tunnel status: ${await client.status()}`; }
            catch (error) { text = `SSH tunnel status failed: ${String(error)}`; }
            await ctx.session.synthetic({ sessionID, text });
          },
        });
      });
    } catch (error) {
      restoreEnvironment();
      throw error;
    }
    return restoreEnvironment;
  },
});
