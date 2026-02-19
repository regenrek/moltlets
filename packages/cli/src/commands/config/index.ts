import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir } from "@clawlets/core/lib/storage/fs-safe";
import { FileSystemConfigStore } from "@clawlets/core/lib/storage/fs-config-store";
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path";
import { deleteAtPath, getAtPath, setAtPath } from "@clawlets/core/lib/storage/object-path";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { getRepoLayout } from "@clawlets/core/repo-layout";
import {
  createDefaultClawletsConfig,
  ClawletsConfigSchema,
  loadClawletsConfig,
  loadFullConfig,
  resolveHostName,
  writeClawletsConfig,
} from "@clawlets/core/lib/config/clawlets-config";
import { validateClawletsConfig } from "@clawlets/core/lib/config/clawlets-config-validate";
import { buildFleetSecretsPlan } from "@clawlets/core/lib/secrets/plan";
import { applySecretsAutowire, planSecretsAutowire, type SecretsAutowireScope } from "@clawlets/core/lib/secrets/secrets-autowire";
import { coerceString, coerceTrimmedString } from "@clawlets/shared/lib/strings";

const store = new FileSystemConfigStore();

const init = defineCommand({
  meta: { name: "init", description: "Initialize fleet/clawlets.json + fleet/openclaw.json (canonical config)." },
  args: {
    host: { type: "string", description: "Initial host name.", default: "openclaw-fleet-host" },
    force: { type: "boolean", description: "Overwrite existing clawlets.json.", default: false },
    "dry-run": { type: "boolean", description: "Print planned writes without writing.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const host = coerceTrimmedString(args.host) || "openclaw-fleet-host";
    const layout = getRepoLayout(repoRoot);
    const infraConfigPath = layout.clawletsConfigPath;
    const openclawConfigPath = layout.openclawConfigPath;
    const writeTargets = `${path.relative(repoRoot, infraConfigPath)} + ${path.relative(repoRoot, openclawConfigPath)}`;

    if ((await store.exists(infraConfigPath)) && !args.force) {
      throw new Error(`config already exists (pass --force to overwrite): ${infraConfigPath}`);
    }

    const config = createDefaultClawletsConfig({ host });

    if ((args as any)["dry-run"]) {
      console.log(`planned: write ${writeTargets}`);
      return;
    }

    await ensureDir(path.dirname(infraConfigPath));
    await writeClawletsConfig({ configPath: infraConfigPath, config });
    console.log(`ok: wrote ${writeTargets}`);
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
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json + fleet/openclaw.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
    yes: { type: "boolean", description: "Skip confirmation (non-interactive).", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { infraConfigPath, openclawConfigPath, config } = loadFullConfig({ repoRoot });
    const writeTargets = `${path.relative(repoRoot, infraConfigPath)} + ${path.relative(repoRoot, openclawConfigPath)}`;
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
      console.log(`planned: update ${writeTargets}`);
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

    await writeClawletsConfig({ configPath: infraConfigPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates: summary }, null, 2));
      return;
    }
    console.log(`ok: updated ${writeTargets}`);
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
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json + fleet/openclaw.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { infraConfigPath, openclawConfigPath, config } = loadFullConfig({ repoRoot });
    const writeTargets = `${path.relative(repoRoot, infraConfigPath)} + ${path.relative(repoRoot, openclawConfigPath)}`;
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
      throw new Error(`hosts.${resolved.host}.gatewaysOrder is empty (set gateways in fleet/openclaw.json)`);
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
      console.log(`planned: update ${writeTargets}`);
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

    await writeClawletsConfig({ configPath: infraConfigPath, config: next });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }
    console.log(`ok: updated ${writeTargets}`);
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
    const { infraConfigPath, config } = loadFullConfig({ repoRoot });
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
      await writeClawletsConfig({ configPath: infraConfigPath, config: validated });
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
      throw new Error(msg, { cause: err });
    }
  },
});

const batchSet = defineCommand({
  meta: { name: "batch-set", description: "Apply multiple dot-path updates to fleet/clawlets.json." },
  args: {
    "ops-json": { type: "string", description: "JSON array of operations: {path,value|valueJson,del?}." },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const raw = coerceTrimmedString((args as any)["ops-json"]);
    if (!raw) throw new Error("missing --ops-json");

    let opsRaw: unknown;
    try {
      opsRaw = JSON.parse(raw);
    } catch {
      throw new Error("invalid --ops-json (must be valid JSON array)");
    }
    if (!Array.isArray(opsRaw)) throw new Error("invalid --ops-json (expected array)");
    if (opsRaw.length === 0) throw new Error("invalid --ops-json (empty array)");
    if (opsRaw.length > 100) throw new Error("invalid --ops-json (max 100 ops)");

    const repoRoot = findRepoRoot(process.cwd());
    const { infraConfigPath, config } = loadFullConfig({ repoRoot });
    const next = structuredClone(config) as any;
    const plannedPaths: string[] = [];

    for (let index = 0; index < opsRaw.length; index++) {
      const row = opsRaw[index];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`invalid op at index ${index}`);
      }
      const op = row as Record<string, unknown>;
      const pathRaw = coerceTrimmedString(op.path);
      if (!pathRaw) throw new Error(`missing path at index ${index}`);
      const parts = splitDotPath(pathRaw);
      const pathKey = parts.join(".");
      plannedPaths.push(pathKey);

      const del = Boolean(op.del);
      const hasValue = op.value !== undefined;
      const hasValueJson = op.valueJson !== undefined;
      if (hasValue && hasValueJson) throw new Error(`ambiguous value at index ${index}`);
      if (del && (hasValue || hasValueJson)) throw new Error(`invalid op at index ${index} (delete with value)`);

      if (del) {
        const ok = deleteAtPath(next, parts);
        if (!ok) throw new Error(`path not found: ${pathKey}`);
        continue;
      }

      if (hasValueJson) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(coerceString(op.valueJson));
        } catch {
          throw new Error(`invalid valueJson at ${pathKey}`);
        }
        setAtPath(next, parts, parsed);
        continue;
      }

      if (hasValue) {
        setAtPath(next, parts, coerceString(op.value));
        continue;
      }

      throw new Error(`missing value for ${pathKey}`);
    }

    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath: infraConfigPath, config: validated });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, updated: plannedPaths }, null, 2));
      return;
    }
    console.log("ok");
  },
});

const replace = defineCommand({
  meta: { name: "replace", description: "Replace fleet/clawlets.json with a full validated JSON object." },
  args: {
    "config-json": { type: "string", description: "Full config JSON object." },
    json: { type: "boolean", description: "JSON output.", default: false },
  },
  async run({ args }) {
    const raw = coerceTrimmedString((args as any)["config-json"]);
    if (!raw) throw new Error("missing --config-json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("invalid --config-json (must be valid JSON object)");
    }
    const validated = ClawletsConfigSchema.parse(parsed);
    const repoRoot = findRepoRoot(process.cwd());
    const configPath = getRepoLayout(repoRoot).clawletsConfigPath;
    await writeClawletsConfig({ configPath, config: validated });
    if (args.json) {
      console.log(JSON.stringify({ ok: true }, null, 2));
      return;
    }
    console.log("ok");
  },
});

export const config = defineCommand({
  meta: { name: "config", description: "Canonical config (fleet/clawlets.json)." },
  subCommands: {
    init,
    show,
    validate,
    get,
    set,
    "batch-set": batchSet,
    replace,
    "wire-secrets": wireSecrets,
    "derive-allowlist": deriveAllowlist,
  },
});
