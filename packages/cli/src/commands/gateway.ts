import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { ClawletsConfigSchema, loadClawletsConfig, resolveHostName, writeClawletsConfig } from "@clawlets/core/lib/clawlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function validateGatewayId(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "gateway id required";
  if (!/^[a-z][a-z0-9_-]*$/.test(v)) return "use: [a-z][a-z0-9_-]*";
  return undefined;
}

const list = defineCommand({
  meta: { name: "list", description: "List bots for a host (from fleet/clawlets.json)." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const hostCfg = (config.hosts as any)?.[resolved.host];
    console.log((hostCfg?.botsOrder || []).join("\n"));
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a bot id to a host in fleet/clawlets.json." },
  args: {
    gateway: { type: "string", description: "Gateway id (e.g. main)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    interactive: { type: "boolean", description: "Prompt for missing inputs (requires TTY).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfig({ repoRoot });
    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const hostCfg = (config.hosts as any)?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);

    let gatewayId = String(args.gateway || "").trim();
    if (!gatewayId) {
      if (!args.interactive) throw new Error("missing --gateway (or pass --interactive)");
      if (!process.stdout.isTTY) throw new Error("--interactive requires a TTY");
      p.intro("clawlets gateway add");
      const v = await p.text({ message: "Gateway id", placeholder: "main", validate: validateGatewayId });
      if (p.isCancel(v)) {
        const nav = await navOnCancel({ flow: "gateway add", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      gatewayId = String(v).trim();
    }

    const err = validateGatewayId(gatewayId);
    if (err) throw new Error(err);

    const existingBots = Array.isArray(hostCfg.botsOrder) ? hostCfg.botsOrder : [];
    const botsById = (hostCfg.bots as any) || {};
    if (existingBots.includes(gatewayId) || botsById[gatewayId]) {
      console.log(`ok: already present: ${gatewayId} (host=${resolved.host})`);
      return;
    }

    const nextHost = {
      ...hostCfg,
      botsOrder: [...existingBots, gatewayId],
      bots: { ...botsById, [gatewayId]: {} },
    };
    const next = {
      ...config,
      hosts: { ...config.hosts, [resolved.host]: nextHost },
    };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: added bot ${gatewayId} (host=${resolved.host})`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove a bot id from a host in fleet/clawlets.json." },
  args: {
    gateway: { type: "string", description: "Gateway id to remove." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfig({ repoRoot });
    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const hostCfg = (config.hosts as any)?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);
    const gatewayId = String(args.gateway || "").trim();
    if (!gatewayId) throw new Error("missing --gateway");
    const existingBots = Array.isArray(hostCfg.botsOrder) ? hostCfg.botsOrder : [];
    const botsById = (hostCfg.bots as any) || {};
    if (!existingBots.includes(gatewayId) && !botsById[gatewayId]) {
      throw new Error(`bot not found on host=${resolved.host}: ${gatewayId}`);
    }
    const nextBotsOrder = existingBots.filter((id) => id !== gatewayId);
    const nextBots = { ...botsById };
    delete (nextBots as any)[gatewayId];
    const nextHost = { ...hostCfg, botsOrder: nextBotsOrder, bots: nextBots };
    const next = { ...config, hosts: { ...config.hosts, [resolved.host]: nextHost } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: removed bot ${gatewayId} (host=${resolved.host})`);
  },
});

export const gateway = defineCommand({
  meta: { name: "gateway", description: "Manage fleet gateways." },
  subCommands: { add, list, rm },
});
