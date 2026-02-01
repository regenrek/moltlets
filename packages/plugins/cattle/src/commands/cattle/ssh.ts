import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawlets/core/lib/deploy-creds";
import { buildCattleLabelSelector, listCattleServers } from "@clawlets/cattle-core/lib/hcloud-cattle";
import { run } from "@clawlets/core/lib/run";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";
import { requireEnabled, resolveOne, resolveTailscaleIpv4 } from "./common.js";

export const cattleSsh = defineCommand({
  meta: { name: "ssh", description: "SSH into a cattle VM over tailnet (admin@<tailscale-ip>)." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    idOrName: { type: "string", description: "Cattle server id or name.", required: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { config } = ctx;

    requireEnabled({
      enabled: Boolean(config.cattle?.enabled),
      hint: "cattle is disabled (set cattle.enabled=true in fleet/clawlets.json)",
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set in .clawlets/env or env var; run: clawlets env init)");

    const servers = await listCattleServers({ token: hcloudToken, labelSelector: buildCattleLabelSelector() });
    const server = resolveOne(servers, String((args as any).idOrName || ""));

    const ip = await resolveTailscaleIpv4(server.name);
    const targetHost = `admin@${ip}`;

    await run("ssh", ["-t", "--", targetHost], { redact: [] });
  },
});

