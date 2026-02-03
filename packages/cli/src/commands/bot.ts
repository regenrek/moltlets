import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { ClawletsConfigSchema, loadClawletsConfig, resolveHostName, writeClawletsConfig } from "@clawlets/core/lib/clawlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function validateBotId(value: string | undefined): string | undefined {
  const v = String(value || "").trim();
  if (!v) return "bot id required";
  if (!/^[a-z][a-z0-9_-]*$/.test(v)) return "use: [a-z][a-z0-9_-]*";
  return undefined;
}

const list = defineCommand({
  meta: { name: "list", description: "List bots (from fleet/clawlets.json)." },
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
    const hostCfg = config.hosts?.[resolved.host];
    console.log((hostCfg?.botsOrder || []).join("\n"));
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a bot id to fleet/clawlets.json." },
  args: {
    bot: { type: "string", description: "Bot id (e.g. maren)." },
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
    const hostCfg = config.hosts?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);

    let botId = String(args.bot || "").trim();
    if (!botId) {
      if (!args.interactive) throw new Error("missing --bot (or pass --interactive)");
      if (!process.stdout.isTTY) throw new Error("--interactive requires a TTY");
      p.intro("clawlets bot add");
      const v = await p.text({ message: "Bot id", placeholder: "maren", validate: validateBotId });
      if (p.isCancel(v)) {
        const nav = await navOnCancel({ flow: "bot add", canBack: false });
        if (nav === NAV_EXIT) cancelFlow();
        return;
      }
      botId = String(v).trim();
    }

    const err = validateBotId(botId);
    if (err) throw new Error(err);

    const existingBots: string[] = Array.isArray(hostCfg.botsOrder)
      ? hostCfg.botsOrder.map((value: unknown) => String(value))
      : [];
    const botsById = (hostCfg.bots as any) || {};
    if (existingBots.includes(botId) || botsById[botId]) {
      console.log(`ok: already present: ${botId} (host=${resolved.host})`);
      return;
    }

    const nextHost = {
      ...hostCfg,
      botsOrder: [...existingBots, botId],
      bots: { ...botsById, [botId]: {} },
    };
    const next = { ...config, hosts: { ...config.hosts, [resolved.host]: nextHost } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: added bot ${botId} (host=${resolved.host})`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove a bot id from fleet/clawlets.json." },
  args: {
    bot: { type: "string", description: "Bot id to remove.", },
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
    const hostCfg = config.hosts?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);
    const botId = String(args.bot || "").trim();
    if (!botId) throw new Error("missing --bot");
    const existingBots: string[] = Array.isArray(hostCfg.botsOrder)
      ? hostCfg.botsOrder.map((value: unknown) => String(value))
      : [];
    const botsById = (hostCfg.bots as any) || {};
    if (!existingBots.includes(botId) && !botsById[botId]) {
      throw new Error(`bot not found on host=${resolved.host}: ${botId}`);
    }
    const nextBotsOrder = existingBots.filter((b) => b !== botId);
    const nextBotsRecord = { ...botsById };
    delete (nextBotsRecord as any)[botId];
    const nextHost = { ...hostCfg, botsOrder: nextBotsOrder, bots: nextBotsRecord };
    const next = { ...config, hosts: { ...config.hosts, [resolved.host]: nextHost } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: removed bot ${botId} (host=${resolved.host})`);
  },
});

export const bot = defineCommand({
  meta: { name: "bot", description: "Manage fleet bots." },
  subCommands: { add, list, rm },
});
