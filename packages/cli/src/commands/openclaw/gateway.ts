import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { ClawletsConfigSchema, loadClawletsConfig, resolveHostName, writeClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import { cancelFlow, navOnCancel, NAV_EXIT } from "../../lib/wizard.js";

function validateGatewayId(value: string | undefined): string | undefined {
  const v = String(value || "").trim();
  if (!v) return "gateway id required";
  if (!/^[a-z][a-z0-9_-]*$/.test(v)) return "use: [a-z][a-z0-9_-]*";
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureObjectField(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isObject(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function parseOptionalBool(value: unknown, flag: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  throw new Error(`invalid ${flag} (expected true|false)`);
}

function parseOptionalPositiveInt(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`invalid ${flag} (expected positive integer)`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid ${flag} (expected positive integer)`);
  return n;
}

function parseOptionalScore(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`invalid ${flag} (expected number in [0,1])`);
  return n;
}

const list = defineCommand({
  meta: { name: "list", description: "List gateways for a host (from fleet/clawlets.json)." },
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
    console.log((hostCfg?.gatewaysOrder || []).join("\n"));
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Add a gateway id to a host in fleet/clawlets.json." },
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
    const hostCfg = config.hosts?.[resolved.host];
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

    const existingGateways: string[] = Array.isArray((hostCfg as any).gatewaysOrder)
      ? (hostCfg as any).gatewaysOrder.map((value: unknown) => String(value))
      : [];
    const gatewaysById = ((hostCfg as any).gateways as any) || {};
    if (existingGateways.includes(gatewayId) || gatewaysById[gatewayId]) {
      console.log(`ok: already present: ${gatewayId} (host=${resolved.host})`);
      return;
    }

    const nextHost = {
      ...hostCfg,
      gatewaysOrder: [...existingGateways, gatewayId],
      gateways: { ...gatewaysById, [gatewayId]: {} },
    };
    const next = {
      ...config,
      hosts: { ...config.hosts, [resolved.host]: nextHost },
    };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: added gateway ${gatewayId} (host=${resolved.host})`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove a gateway id from a host in fleet/clawlets.json." },
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
    const hostCfg = config.hosts?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);
    const gatewayId = String(args.gateway || "").trim();
    if (!gatewayId) throw new Error("missing --gateway");
    const existingGateways: string[] = Array.isArray((hostCfg as any).gatewaysOrder)
      ? (hostCfg as any).gatewaysOrder.map((value: unknown) => String(value))
      : [];
    const gatewaysById = ((hostCfg as any).gateways as any) || {};
    if (!existingGateways.includes(gatewayId) && !gatewaysById[gatewayId]) {
      throw new Error(`gateway not found on host=${resolved.host}: ${gatewayId}`);
    }
    const nextGatewaysOrder = existingGateways.filter((id) => id !== gatewayId);
    const nextGateways = { ...gatewaysById };
    delete (nextGateways as any)[gatewayId];
    const nextHost = { ...hostCfg, gatewaysOrder: nextGatewaysOrder, gateways: nextGateways };
    const next = { ...config, hosts: { ...config.hosts, [resolved.host]: nextHost } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: removed gateway ${gatewayId} (host=${resolved.host})`);
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set gateway memory backend/settings in fleet/clawlets.json." },
  args: {
    gateway: { type: "string", description: "Gateway id." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    backend: { type: "string", description: "Memory backend: builtin|qmd." },
    "builtin-enabled": { type: "string", description: "agents.defaults.memorySearch.enabled (true/false)." },
    "builtin-session-memory": { type: "string", description: "agents.defaults.memorySearch.experimental.sessionMemory (true/false)." },
    "builtin-max-results": { type: "string", description: "agents.defaults.memorySearch.query.maxResults (>0)." },
    "builtin-min-score": { type: "string", description: "agents.defaults.memorySearch.query.minScore (0..1)." },
    "qmd-command": { type: "string", description: "openclaw.memory.qmd.command (default: qmd)." },
    "qmd-sessions-enabled": { type: "string", description: "openclaw.memory.qmd.sessions.enabled (true/false)." },
    "qmd-max-results": { type: "string", description: "openclaw.memory.qmd.limits.maxResults (>0)." },
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

    const gatewayId = String(args.gateway || "").trim();
    const err = validateGatewayId(gatewayId);
    if (err) throw new Error(err);

    const gatewaysById = ((hostCfg as any).gateways as Record<string, unknown>) || {};
    const existingGateway = gatewaysById[gatewayId];
    if (!isObject(existingGateway)) {
      throw new Error(`gateway not found on host=${resolved.host}: ${gatewayId}`);
    }

    const backendRaw = String((args as any).backend || "").trim();
    const backend =
      backendRaw === "builtin" || backendRaw === "qmd"
        ? backendRaw
        : backendRaw
          ? (() => {
              throw new Error(`invalid --backend: ${backendRaw} (expected builtin|qmd)`);
            })()
          : undefined;

    const builtinEnabled = parseOptionalBool((args as any)["builtin-enabled"], "--builtin-enabled");
    const builtinSessionMemory = parseOptionalBool((args as any)["builtin-session-memory"], "--builtin-session-memory");
    const builtinMaxResults = parseOptionalPositiveInt((args as any)["builtin-max-results"], "--builtin-max-results");
    const builtinMinScore = parseOptionalScore((args as any)["builtin-min-score"], "--builtin-min-score");
    const qmdSessionsEnabled = parseOptionalBool((args as any)["qmd-sessions-enabled"], "--qmd-sessions-enabled");
    const qmdMaxResults = parseOptionalPositiveInt((args as any)["qmd-max-results"], "--qmd-max-results");
    const qmdCommandRaw = (args as any)["qmd-command"];
    const qmdCommand = qmdCommandRaw === undefined ? undefined : String(qmdCommandRaw).trim();

    if (
      backend === undefined
      && builtinEnabled === undefined
      && builtinSessionMemory === undefined
      && builtinMaxResults === undefined
      && builtinMinScore === undefined
      && qmdCommand === undefined
      && qmdSessionsEnabled === undefined
      && qmdMaxResults === undefined
    ) {
      throw new Error("no changes requested");
    }

    const nextHost = structuredClone(hostCfg) as Record<string, unknown>;
    const nextGateways = (isObject(nextHost.gateways) ? nextHost.gateways : {}) as Record<string, unknown>;
    nextHost.gateways = nextGateways;
    const nextGateway = structuredClone(existingGateway) as Record<string, unknown>;
    nextGateways[gatewayId] = nextGateway;

    if (backend !== undefined || qmdCommand !== undefined || qmdSessionsEnabled !== undefined || qmdMaxResults !== undefined) {
      const openclaw = ensureObjectField(nextGateway, "openclaw");
      const memory = ensureObjectField(openclaw, "memory");
      if (backend !== undefined) memory.backend = backend;
      if (qmdCommand !== undefined || qmdSessionsEnabled !== undefined || qmdMaxResults !== undefined) {
        const qmd = ensureObjectField(memory, "qmd");
        if (qmdCommand !== undefined) qmd.command = qmdCommand || "qmd";
        if (qmdSessionsEnabled !== undefined) {
          const sessions = ensureObjectField(qmd, "sessions");
          sessions.enabled = qmdSessionsEnabled;
        }
        if (qmdMaxResults !== undefined) {
          const limits = ensureObjectField(qmd, "limits");
          limits.maxResults = qmdMaxResults;
        }
      }
    }

    if (builtinEnabled !== undefined || builtinSessionMemory !== undefined || builtinMaxResults !== undefined || builtinMinScore !== undefined) {
      const agents = ensureObjectField(nextGateway, "agents");
      const defaults = ensureObjectField(agents, "defaults");
      const memorySearch = ensureObjectField(defaults, "memorySearch");
      if (builtinEnabled !== undefined) memorySearch.enabled = builtinEnabled;
      if (builtinSessionMemory !== undefined) {
        const experimental = ensureObjectField(memorySearch, "experimental");
        experimental.sessionMemory = builtinSessionMemory;
      }
      if (builtinMaxResults !== undefined || builtinMinScore !== undefined) {
        const query = ensureObjectField(memorySearch, "query");
        if (builtinMaxResults !== undefined) query.maxResults = builtinMaxResults;
        if (builtinMinScore !== undefined) query.minScore = builtinMinScore;
      }
    }

    const next = { ...config, hosts: { ...config.hosts, [resolved.host]: nextHost } };
    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log(`ok: updated gateway ${gatewayId} (host=${resolved.host})`);
  },
});

export const gateway = defineCommand({
  meta: { name: "gateway", description: "Manage fleet gateways." },
  subCommands: { add, list, rm, set },
});
