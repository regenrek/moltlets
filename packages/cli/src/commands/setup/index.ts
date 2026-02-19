import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { ClawletsConfigSchema, loadFullConfig, writeClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import {
  DEPLOY_CREDS_KEYS,
  loadDeployCreds,
  resolveActiveDeployCredsProjectToken,
  updateDeployCredsEnvFile,
} from "@clawlets/core/lib/infra/deploy-creds";
import { mkpasswdYescryptHash } from "@clawlets/core/lib/security/mkpasswd";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path";
import { deleteAtPath, setAtPath } from "@clawlets/core/lib/storage/object-path";

type SetupApplyConfigOp = {
  path: string;
  value?: string;
  valueJson?: string;
  del: boolean;
};

type SetupApplyPayload = {
  hostName: string;
  configOps: SetupApplyConfigOp[];
  deployCreds: Record<string, string>;
  bootstrapSecrets: Record<string, string>;
};

function hasForbiddenText(value: string): boolean {
  return value.includes("\0") || value.includes("\r");
}

function ensureNoExtraKeys(value: Record<string, unknown>, field: string, keys: string[]): void {
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (extra.length > 0) throw new Error(`${field} contains unsupported keys: ${extra.join(",")}`);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeStringMap(value: unknown, field: string): Record<string, string> {
  const input = asObject(value, field);
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`${field}.${rawKey} invalid key`);
    if (typeof rawValue !== "string") throw new Error(`${field}.${key} must be string`);
    out[key] = rawValue;
  }
  return out;
}

function parseConfigOps(value: unknown): SetupApplyConfigOp[] {
  if (!Array.isArray(value)) throw new Error("configOps must be an array");
  if (value.length === 0) throw new Error("configOps must not be empty");
  if (value.length > 200) throw new Error("configOps too many entries");
  const out: SetupApplyConfigOp[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = asObject(value[index], `configOps[${index}]`);
    ensureNoExtraKeys(row, `configOps[${index}]`, ["path", "value", "valueJson", "del"]);
    const rawPath = typeof row.path === "string" ? row.path : "";
    const parts = splitDotPath(rawPath);
    const normalizedPath = parts.join(".");
    const del = Boolean(row.del);
    const valueRaw = row.value;
    const valueJsonRaw = row.valueJson;
    const hasValue = typeof valueRaw === "string";
    const hasValueJson = typeof valueJsonRaw === "string";
    if (hasValue && hasValueJson) throw new Error(`configOps[${index}] ambiguous value`);
    if (del && (hasValue || hasValueJson)) throw new Error(`configOps[${index}] delete cannot include value`);
    if (!del && !hasValue && !hasValueJson) throw new Error(`configOps[${index}] missing value`);
    if (hasValue && hasForbiddenText(valueRaw)) throw new Error(`configOps[${index}].value invalid`);
    if (hasValueJson) {
      if (hasForbiddenText(valueJsonRaw)) throw new Error(`configOps[${index}].valueJson invalid`);
      try {
        JSON.parse(valueJsonRaw);
      } catch {
        throw new Error(`configOps[${index}].valueJson invalid JSON`);
      }
    }
    out.push({
      path: normalizedPath,
      value: hasValue ? valueRaw : undefined,
      valueJson: hasValueJson ? valueJsonRaw : undefined,
      del,
    });
  }
  return out;
}

function parseSetupApplyPayload(rawJson: string): SetupApplyPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("invalid --from-json payload");
  }
  const root = asObject(parsed, "payload");
  ensureNoExtraKeys(root, "payload", ["hostName", "configOps", "deployCreds", "bootstrapSecrets"]);
  const hostName = typeof root.hostName === "string" ? root.hostName.trim() : "";
  if (!hostName) throw new Error("payload.hostName required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(hostName)) throw new Error("payload.hostName invalid");
  return {
    hostName,
    configOps: parseConfigOps(root.configOps),
    deployCreds: normalizeStringMap(root.deployCreds, "payload.deployCreds"),
    bootstrapSecrets: normalizeStringMap(root.bootstrapSecrets, "payload.bootstrapSecrets"),
  };
}

function setupApplyEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "1",
    CLAWLETS_NON_INTERACTIVE: "1",
  };
}

async function applyConfigOps(params: {
  repoRoot: string;
  runtimeDir?: string;
  ops: SetupApplyConfigOp[];
}): Promise<string[]> {
  const loaded = loadFullConfig({ repoRoot: params.repoRoot, runtimeDir: params.runtimeDir });
  const next = structuredClone(loaded.config) as any;
  const updatedPaths: string[] = [];
  for (const op of params.ops) {
    const parts = splitDotPath(op.path);
    const pathKey = parts.join(".");
    if (op.del) {
      const removed = deleteAtPath(next, parts);
      // Deletes must be idempotent for first-time setup and safe re-runs.
      if (removed) updatedPaths.push(pathKey);
      continue;
    }
    if (typeof op.valueJson === "string") {
      setAtPath(next, parts, JSON.parse(op.valueJson));
      updatedPaths.push(pathKey);
      continue;
    }
    if (typeof op.value === "string") {
      setAtPath(next, parts, op.value);
      updatedPaths.push(pathKey);
      continue;
    }
    throw new Error(`config op missing value for ${pathKey}`);
  }
  const validated = ClawletsConfigSchema.parse(next);
  await writeClawletsConfig({ configPath: loaded.infraConfigPath, config: validated });
  return updatedPaths;
}

async function buildSecretsInitBody(params: {
  bootstrapSecrets: Record<string, string>;
  repoRoot: string;
  nixBin: string;
  tailscaleAuthKeyFallback?: string;
}): Promise<{
  adminPasswordHash?: string;
  tailscaleAuthKey?: string;
  secrets: Record<string, string>;
}> {
  const adminPasswordHashRaw = String(params.bootstrapSecrets["adminPasswordHash"] || "").trim();
  const adminPasswordRaw = String(params.bootstrapSecrets["adminPassword"] || "").trim();
  const tailscaleAuthKey =
    String(
      params.bootstrapSecrets["tailscaleAuthKey"]
        || params.bootstrapSecrets["tailscale_auth_key"]
        || params.tailscaleAuthKeyFallback
        || "",
    ).trim();
  const adminPasswordHash = adminPasswordHashRaw
    || (adminPasswordRaw
      ? await mkpasswdYescryptHash(adminPasswordRaw, {
          nixBin: params.nixBin,
          cwd: params.repoRoot,
          dryRun: false,
          env: setupApplyEnv(),
        })
      : "");
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.bootstrapSecrets)) {
    if (
      key === "adminPasswordHash"
      || key === "adminPassword"
      || key === "tailscaleAuthKey"
      || key === "tailscale_auth_key"
    ) continue;
    const normalized = key.trim();
    if (!normalized) continue;
    secrets[normalized] = value;
  }
  return {
    ...(adminPasswordHash ? { adminPasswordHash } : {}),
    ...(tailscaleAuthKey ? { tailscaleAuthKey } : {}),
    secrets,
  };
}

function summarizeVerifyResults(rawJson: string): { ok: number; missing: number; warn: number; total: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("secrets verify returned invalid JSON");
  }
  const root = asObject(parsed, "verify result");
  const rows = Array.isArray(root.results) ? root.results : [];
  let ok = 0;
  let missing = 0;
  let warn = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const status = String((row as Record<string, unknown>).status || "").trim();
    if (status === "ok") ok += 1;
    else if (status === "missing") missing += 1;
    else if (status === "warn") warn += 1;
  }
  return { ok, missing, warn, total: rows.length };
}

const setupApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply setup draft payload from JSON in one non-interactive pass.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Deploy creds env file (default: <runtimeDir>/env)." },
    fromJson: { type: "string", required: true, description: "Path to setup payload JSON." },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const runtimeDir = typeof (args as any).runtimeDir === "string" ? String((args as any).runtimeDir) : undefined;
    const envFile = typeof (args as any).envFile === "string" ? String((args as any).envFile) : undefined;
    const fromJsonRaw = String((args as any).fromJson || "").trim();
    if (!fromJsonRaw) throw new Error("missing --from-json");
    const fromJsonPath = path.isAbsolute(fromJsonRaw) ? fromJsonRaw : path.resolve(cwd, fromJsonRaw);
    const payload = parseSetupApplyPayload(await fs.readFile(fromJsonPath, "utf8"));
    const deployCredsUpdates: Record<string, string> = {};
    for (const key of DEPLOY_CREDS_KEYS) {
      if (typeof payload.deployCreds[key] === "string") {
        deployCredsUpdates[key] = payload.deployCreds[key];
      }
    }
    if (Object.keys(deployCredsUpdates).length === 0) {
      throw new Error("payload.deployCreds has no recognized deploy creds keys");
    }

    const cliEntry = process.argv[1];
    if (!cliEntry) throw new Error("unable to resolve CLI entry path");
    const secretsInitPath = path.join(
      os.tmpdir(),
      `clawlets-setup-apply.${payload.hostName}.${process.pid}.${randomUUID()}.json`,
    );

    try {
      const updatedConfigPaths = await applyConfigOps({
        repoRoot,
        runtimeDir,
        ops: payload.configOps,
      });
      const deployCredsResult = await updateDeployCredsEnvFile({
        repoRoot,
        runtimeDir,
        envFile,
        updates: deployCredsUpdates,
      });
      const resolvedDeployCreds = loadDeployCreds({
        cwd: repoRoot,
        runtimeDir,
        envFile,
      });
      const tailscaleAuthKeyFromDeployCreds = String(
        resolveActiveDeployCredsProjectToken({
          keyringRaw: resolvedDeployCreds.values.TAILSCALE_AUTH_KEY_KEYRING,
          activeIdRaw: resolvedDeployCreds.values.TAILSCALE_AUTH_KEY_KEYRING_ACTIVE,
        }) || "",
      ).trim();
      const bootstrapSecrets = payload.bootstrapSecrets;
      const nixBin = String(deployCredsUpdates.NIX_BIN || process.env.NIX_BIN || "nix").trim() || "nix";
      const secretsInitBody = await buildSecretsInitBody({
        bootstrapSecrets,
        repoRoot,
        nixBin,
        tailscaleAuthKeyFallback: tailscaleAuthKeyFromDeployCreds,
      });
      await fs.writeFile(secretsInitPath, `${JSON.stringify(secretsInitBody, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const sopsAgeKeyFile = String(deployCredsUpdates.SOPS_AGE_KEY_FILE || "").trim();
      const ageKeyArgs = sopsAgeKeyFile ? ["--ageKeyFile", sopsAgeKeyFile] : [];
      await run(
        process.execPath,
        [
          cliEntry,
          "secrets",
          "init",
          "--host",
          payload.hostName,
          "--scope",
          "bootstrap",
          "--from-json",
          secretsInitPath,
          "--allowMissingAdminPasswordHash",
          ...ageKeyArgs,
          "--yes",
        ],
        {
          cwd: repoRoot,
          env: setupApplyEnv(),
          stdin: "ignore",
          stdout: "ignore",
        },
      );
      const verifyRaw = await capture(
        process.execPath,
        [
          cliEntry,
          "secrets",
          "verify",
          "--host",
          payload.hostName,
          "--scope",
          "bootstrap",
          ...ageKeyArgs,
          "--json",
        ],
        {
          cwd: repoRoot,
          env: setupApplyEnv(),
          stdin: "ignore",
          maxOutputBytes: 512 * 1024,
        },
      );
      const verifySummary = summarizeVerifyResults(verifyRaw);
      const summary = {
        ok: true as const,
        hostName: payload.hostName,
        config: {
          updatedPaths: updatedConfigPaths,
          updatedCount: updatedConfigPaths.length,
        },
        deployCreds: {
          updatedKeys: deployCredsResult.updatedKeys,
        },
        bootstrapSecrets: {
          submittedCount: Object.keys(bootstrapSecrets).length,
          verify: verifySummary,
        },
      };
      if ((args as any).json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      console.log(`ok: setup apply completed for ${summary.hostName}`);
      console.log(`- config paths updated: ${summary.config.updatedCount}`);
      console.log(`- deploy creds updated: ${summary.deployCreds.updatedKeys.join(", ")}`);
      console.log(`- secrets verify: ok=${verifySummary.ok} missing=${verifySummary.missing} warn=${verifySummary.warn}`);
    } finally {
      await fs.rm(secretsInitPath, { force: true });
    }
  },
});

export const setup = defineCommand({
  meta: {
    name: "setup",
    description: "Setup helper commands.",
  },
  subCommands: {
    apply: setupApply,
  },
});
