import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { ClawletsConfigSchema, loadClawletsConfig, writeClawletsConfig } from "@clawlets/core/lib/clawlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../lib/wizard.js";

function validateGatewayId(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "gateway id required";
  if (!/^[a-z][a-z0-9_-]*$/.test(v)) return "use: [a-z][a-z0-9_-]*";
  return undefined;
}

const list = defineCommand({
  meta: { name: "list", description: "List gateways (from fleet/clawlets.json)." },
  args: {},
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    console.log((config.fleet.gatewayOrder || []).join("\n"));
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a gateway id to fleet/clawlets.json." },
  args: {
    gateway: { type: "string", description: "Gateway id (e.g. main)." },
    interactive: { type: "boolean", description: "Prompt for missing inputs (requires TTY).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfig({ repoRoot });

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

    const existingGateways = config.fleet.gatewayOrder;
    if (existingGateways.includes(gatewayId) || config.fleet.gateways[gatewayId]) {
      console.log(`ok: already present: ${gatewayId}`);
      return;
    }

    const next = {
      ...config,
      fleet: {
        ...config.fleet,
        gatewayOrder: [...existingGateways, gatewayId],
        gateways: { ...config.fleet.gateways, [gatewayId]: {} },
      },
    };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: added gateway ${gatewayId}`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove a gateway id from fleet/clawlets.json." },
  args: {
    gateway: { type: "string", description: "Gateway id to remove." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfig({ repoRoot });
    const gatewayId = String(args.gateway || "").trim();
    if (!gatewayId) throw new Error("missing --gateway");
    const existingGateways = config.fleet.gatewayOrder;
    if (!existingGateways.includes(gatewayId) && !config.fleet.gateways[gatewayId]) {
      throw new Error(`gateway not found: ${gatewayId}`);
    }
    const nextGateways = existingGateways.filter((id) => id !== gatewayId);
    const nextGatewaysRecord = { ...config.fleet.gateways };
    delete (nextGatewaysRecord as any)[gatewayId];
    const next = { ...config, fleet: { ...config.fleet, gatewayOrder: nextGateways, gateways: nextGatewaysRecord } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: removed gateway ${gatewayId}`);
  },
});

export const gateway = defineCommand({
  meta: { name: "gateway", description: "Manage fleet gateways." },
  subCommands: { add, list, rm },
});
