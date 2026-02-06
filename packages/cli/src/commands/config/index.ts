import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir } from "@clawlets/core/lib/storage/fs-safe";
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path";
import { deleteAtPath, getAtPath, setAtPath } from "@clawlets/core/lib/storage/object-path";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { getRepoLayout } from "@clawlets/core/repo-layout";
import {
  createDefaultClawletsConfig,
  CLAWLETS_CONFIG_SCHEMA_VERSION,
  ClawletsConfigSchema,
  InfraConfigSchema,
  OpenClawConfigSchema,
  loadClawletsConfig,
  loadClawletsConfigRaw,
  resolveHostName,
  writeInfraConfig,
  writeOpenClawConfig,
  writeClawletsConfig,
} from "@clawlets/core/lib/config/clawlets-config";
import { migrateClawletsConfigToLatest } from "@clawlets/core/lib/config/clawlets-config-migrate";
import { validateClawletsConfig } from "@clawlets/core/lib/config/clawlets-config-validate";
import { buildFleetSecretsPlan } from "@clawlets/core/lib/secrets/plan";
import { applySecretsAutowire, planSecretsAutowire, type SecretsAutowireScope } from "@clawlets/core/lib/secrets/secrets-autowire";

const init = defineCommand({
  meta: { name: "init", description: "Initialize fleet/clawlets.json (canonical config)." },
  args: {
    host: { type: "string", description: "Initial host name.", default: "openclaw-fleet-host" },
    force: { type: "boolean", description: "Overwrite existing clawlets.json.", default: false },
    "dry-run": { type: "boolean", description: "Print planned writes without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const host = String(args.host || "openclaw-fleet-host").trim() || "openclaw-fleet-host";
    const configPath = getRepoLayout(repoRoot).clawletsConfigPath;

    if (fs.existsSync(configPath) && !args.force) {
      throw new Error(`config already exists (pass --force to overwrite): ${configPath}`);
    }

    const config = createDefaultClawletsConfig({ host });

    if ((args as any)["dry-run"]) {
      console.log(`planned: write ${path.relative(repoRoot, configPath)}`);
      return;
    }

    await ensureDir(path.dirname(configPath));
    await writeClawletsConfig({ configPath, config });
    console.log(`ok: wrote ${path.relative(repoRoot, configPath)}`);
  },
});


const show = defineCommand({
  meta: { name: "show", description: "Print fleet/clawlets.json." },
  args: {
    pretty: { type: "boolean", description: "Pretty-print JSON.", default: true },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    console.log(args.pretty ? JSON.stringify(config, null, 2) : JSON.stringify(config));
  },
});

const validate = defineCommand({
  meta: { name: "validate", description: "Validate fleet/clawlets.json + rendered OpenClaw config." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    strict: { type: "boolean", description: "Fail on warnings (inline secrets, invariant overrides).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    const resolved = resolveHostName({ config, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const res = validateClawletsConfig({ config, hostName: resolved.host, strict: Boolean(args.strict) });
    for (const w of res.warnings) console.error(`warn: ${w}`);
    if (!res.ok) {
      for (const e of res.errors) console.error(`error: ${e}`);
      throw new Error("config validation failed");
    }
    console.log("ok");
  },
});

const wireSecrets = defineCommand({
  meta: { name: "wire-secrets", description: "Autowire missing secretEnv mappings." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    gateway: { type: "string", description: "Only wire secrets for this gateway id." },
    scope: { type: "string", description: "Override scope (gateway|fleet)." },
    only: { type: "string", description: "Only wire a specific ENV_VAR (comma-separated)." },
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
    yes: { type: "boolean", description: "Skip confirmation (non-interactive).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfigRaw({ repoRoot });
    const validated = ClawletsConfigSchema.parse(config);
    const resolved = resolveHostName({ config: validated, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }

    const scopeRaw = String(args.scope || "").trim();
    const scope = scopeRaw ? (scopeRaw === "gateway" || scopeRaw === "fleet" ? (scopeRaw as SecretsAutowireScope) : null) : null;
    if (scopeRaw && !scope) throw new Error(`invalid --scope: ${scopeRaw} (expected gateway|fleet)`);

    const onlyEnvVars = String(args.only || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const plan = planSecretsAutowire({
      config: validated,
      hostName: resolved.host,
      scope: scope ?? undefined,
      gatewayId: args.gateway ? String(args.gateway).trim() : undefined,
      onlyEnvVars,
    });

    if (plan.updates.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, updates: [] }, null, 2));
      } else {
        console.log("ok: no missing secretEnv mappings");
      }
      return;
    }

    const summary = plan.updates.map((u) => ({
      gatewayId: u.gatewayId,
      envVar: u.envVar,
      scope: u.scope,
      secretName: u.secretName,
    }));

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates: summary }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const entry of summary) {
        const target =
          entry.scope === "fleet"
            ? `fleet.secretEnv.${entry.envVar}`
            : `hosts.${resolved.host}.gateways.${entry.gatewayId}.profile.secretEnv.${entry.envVar}`;
        console.log(`- ${target} = ${entry.secretName}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const next = applySecretsAutowire({ config: validated, plan, hostName: resolved.host });
    const validation = validateClawletsConfig({ config: next, hostName: resolved.host });
    if (!validation.ok) {
      for (const e of validation.errors) console.error(`error: ${e}`);
      throw new Error("autowire failed: validation errors");
    }

    await writeClawletsConfig({ configPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates: summary }, null, 2));
      return;
    }
    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const entry of summary) {
      const target =
        entry.scope === "fleet"
          ? `fleet.secretEnv.${entry.envVar}`
          : `hosts.${resolved.host}.gateways.${entry.gatewayId}.profile.secretEnv.${entry.envVar}`;
      console.log(`- ${target} = ${entry.secretName}`);
    }
  },
});

const deriveAllowlist = defineCommand({
  meta: { name: "derive-allowlist", description: "Derive per-gateway secretEnvAllowlist from current config." },
  args: {
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    gateway: { type: "string", description: "Only derive allowlist for this gateway id." },
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfigRaw({ repoRoot });
    const validated = ClawletsConfigSchema.parse(config);
    const resolved = resolveHostName({ config: validated, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }

    const plan = buildFleetSecretsPlan({ config: validated, hostName: resolved.host });
    const gatewayArg = args.gateway ? String(args.gateway).trim() : "";
    const hostCfg = validated.hosts?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);
    const gateways: string[] = gatewayArg
      ? [gatewayArg]
      : Array.isArray(hostCfg.gatewaysOrder)
        ? hostCfg.gatewaysOrder.map((value) => String(value))
        : [];
    if (gateways.length === 0) {
      throw new Error(`hosts.${resolved.host}.gatewaysOrder is empty (set gateways in fleet/clawlets.json)`);
    }

    const updates = gateways.map((gatewayId) => {
      const envVars = plan.byGateway?.[gatewayId]?.envVarsRequired;
      if (!envVars) throw new Error(`unknown gateway id: ${gatewayId}`);
      return { gatewayId, allowlist: envVars };
    });

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const entry of updates) {
        console.log(`- hosts.${resolved.host}.gateways.${entry.gatewayId}.profile.secretEnvAllowlist = ${JSON.stringify(entry.allowlist)}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const next = structuredClone(validated) as any;
    if (!next.hosts?.[resolved.host]) throw new Error(`missing host in config.hosts: ${resolved.host}`);
    for (const entry of updates) {
      if (!next.hosts[resolved.host].gateways) next.hosts[resolved.host].gateways = {};
      if (!next.hosts[resolved.host].gateways[entry.gatewayId]) next.hosts[resolved.host].gateways[entry.gatewayId] = {};
      if (!next.hosts[resolved.host].gateways[entry.gatewayId].profile) next.hosts[resolved.host].gateways[entry.gatewayId].profile = {};
      next.hosts[resolved.host].gateways[entry.gatewayId].profile.secretEnvAllowlist = entry.allowlist;
    }

    const validation = validateClawletsConfig({ config: next, hostName: resolved.host });
    if (!validation.ok) {
      for (const e of validation.errors) console.error(`error: ${e}`);
      throw new Error("allowlist derive failed: validation errors");
    }

    await writeClawletsConfig({ configPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }
    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const entry of updates) {
      console.log(`- hosts.${resolved.host}.gateways.${entry.gatewayId}.profile.secretEnvAllowlist = ${JSON.stringify(entry.allowlist)}`);
    }
  },
});

const get = defineCommand({
  meta: { name: "get", description: "Get a value from fleet/clawlets.json (dot path)." },
  args: {
    path: { type: "string", description: "Dot path (e.g. hosts.<host>.gatewaysOrder)." },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    const parts = splitDotPath(String(args.path || ""));
    const v = getAtPath(config as any, parts);
    if (args.json) console.log(JSON.stringify({ path: parts.join("."), value: v }, null, 2));
    else console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set a value in fleet/clawlets.json (dot path)." },
  args: {
    path: { type: "string", description: "Dot path (e.g. hosts.<host>.gatewaysOrder)." },
    value: { type: "string", description: "String value." },
    "value-json": { type: "string", description: "JSON value (parsed)." },
    delete: { type: "boolean", description: "Delete the key at path.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfigRaw({ repoRoot });
    const parts = splitDotPath(String(args.path || ""));

    const next = structuredClone(config) as any;

    if (args.delete) {
      const ok = deleteAtPath(next, parts);
      if (!ok) throw new Error(`path not found: ${parts.join(".")}`);
    } else if ((args as any)["value-json"] !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String((args as any)["value-json"]));
      } catch {
        throw new Error("invalid --value-json (must be valid JSON)");
      }
      setAtPath(next, parts, parsed);
    } else if (args.value !== undefined) {
      setAtPath(next, parts, String(args.value));
    } else {
      throw new Error("set requires --value or --value-json (or --delete)");
    }

    try {
      const validated = ClawletsConfigSchema.parse(next);
      await writeClawletsConfig({ configPath, config: validated });
      console.log("ok");
    } catch (err: any) {
      let details = "";
      if (Array.isArray(err?.errors)) {
        details = err.errors
          .map((e: any) => (Array.isArray(e.path) ? e.path.join(".") : "") || e.message)
          .filter(Boolean)
          .join(", ");
      }
      const msg = details
        ? `config update failed; revert or fix validation errors: ${details}`
        : "config update failed; revert or fix validation errors";
      throw new Error(msg);
    }
  },
});

const migrate = defineCommand({
  meta: { name: "migrate", description: "Migrate fleet/clawlets.json to a new schema version." },
  args: {
    to: {
      type: "string",
      description: `Target schema version (only v${CLAWLETS_CONFIG_SCHEMA_VERSION} supported).`,
      default: `v${CLAWLETS_CONFIG_SCHEMA_VERSION}`,
    },
    "dry-run": { type: "boolean", description: "Print planned write without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const configPath = getRepoLayout(repoRoot).clawletsConfigPath;
    if (!fs.existsSync(configPath)) throw new Error(`missing config: ${configPath}`);

    const rawText = fs.readFileSync(configPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`invalid JSON: ${configPath}`);
    }

    const target = `v${CLAWLETS_CONFIG_SCHEMA_VERSION}`;
    const to = String((args as any).to || target).trim().toLowerCase();
    if (to !== target && to !== String(CLAWLETS_CONFIG_SCHEMA_VERSION)) {
      throw new Error(`unsupported --to: ${to} (expected ${target})`);
    }

    const res = migrateClawletsConfigToLatest(parsed);
    if (!res.changed) {
      console.log(`ok: already schemaVersion ${CLAWLETS_CONFIG_SCHEMA_VERSION}`);
      return;
    }

    const validated = InfraConfigSchema.parse(res.migrated);
    const openclawValidated = OpenClawConfigSchema.parse(
      res.openclawConfig || {
        schemaVersion: 1,
        hosts: {},
        fleet: { secretEnv: {}, secretFiles: {}, gatewayArchitecture: "multi", codex: { enable: false, gateways: [] } },
      },
    );

    if ((args as any)["dry-run"]) {
      console.log(`planned: write ${path.relative(repoRoot, configPath)}`);
      for (const w of res.warnings) console.log(`warn: ${w}`);
      return;
    }

    await ensureDir(path.dirname(configPath));
    await writeInfraConfig({ configPath, config: validated });
    await writeOpenClawConfig({ configPath: getRepoLayout(repoRoot).openclawConfigPath, config: openclawValidated });
    console.log(
      `ok: migrated to schemaVersion ${CLAWLETS_CONFIG_SCHEMA_VERSION}: ${path.relative(repoRoot, configPath)} + ${path.relative(repoRoot, getRepoLayout(repoRoot).openclawConfigPath)}`,
    );
    for (const w of res.warnings) console.log(`warn: ${w}`);
  },
});

export const config = defineCommand({
  meta: { name: "config", description: "Canonical config (fleet/clawlets.json)." },
  subCommands: { init, show, validate, migrate, get, set, "wire-secrets": wireSecrets, "derive-allowlist": deriveAllowlist },
});
