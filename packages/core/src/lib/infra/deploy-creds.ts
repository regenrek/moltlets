import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ensurePrivateRuntimeDir, getRepoLayout } from "../../repo-layout.js";
import {
  AWS_DEPLOY_CREDS_KEY_SPECS,
  GITHUB_DEPLOY_CREDS_KEY_SPECS,
  HETZNER_DEPLOY_CREDS_KEY_SPECS,
  type DeployCredsKeySpec,
} from "./deploy-creds-providers/index.js";
import { findRepoRoot } from "../project/repo.js";
import { writeFileAtomic } from "../storage/fs-safe.js";
import { formatDotenvValue } from "../storage/dotenv-file.js";
import { expandPath } from "../storage/path-expand.js";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

const BASE_DEPLOY_CREDS_KEY_SPECS = [
  { key: "NIX_BIN", secret: false, defaultValue: "nix" },
  { key: "SOPS_AGE_KEY_FILE", secret: false, defaultValue: "" },
  { key: "GIT_REMOTE_ORIGIN", secret: false, defaultValue: "" },
  // JSON payload: {"items":[{"id":"...","label":"...","value":"..."}]}
  { key: "HCLOUD_TOKEN_KEYRING", secret: true, defaultValue: "" },
  { key: "HCLOUD_TOKEN_KEYRING_ACTIVE", secret: false, defaultValue: "" },
] as const satisfies readonly DeployCredsKeySpec[];

export const DEPLOY_CREDS_KEY_SPECS = [
  ...HETZNER_DEPLOY_CREDS_KEY_SPECS,
  ...GITHUB_DEPLOY_CREDS_KEY_SPECS,
  ...BASE_DEPLOY_CREDS_KEY_SPECS,
  ...AWS_DEPLOY_CREDS_KEY_SPECS,
] as const satisfies readonly DeployCredsKeySpec[];

function assertUniqueDeployCredsKeySpecs(specs: readonly DeployCredsKeySpec[]): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.key)) throw new Error(`duplicate deploy creds key spec: ${spec.key}`);
    seen.add(spec.key);
  }
}

assertUniqueDeployCredsKeySpecs(DEPLOY_CREDS_KEY_SPECS);

export type DeployCredsKey = (typeof DEPLOY_CREDS_KEY_SPECS)[number]["key"];

export const DEPLOY_CREDS_KEYS = DEPLOY_CREDS_KEY_SPECS.map((spec) => spec.key) as readonly DeployCredsKey[];

const DEPLOY_CREDS_SECRET_KEY_SET = new Set<DeployCredsKey>(
  DEPLOY_CREDS_KEY_SPECS.filter((spec) => spec.secret).map((spec) => spec.key),
);

export const DEPLOY_CREDS_SECRET_KEYS = [...DEPLOY_CREDS_SECRET_KEY_SET] as readonly DeployCredsKey[];

export function isDeployCredsSecretKey(key: DeployCredsKey): boolean {
  return DEPLOY_CREDS_SECRET_KEY_SET.has(key);
}

export type DeployCredsEnvFileKeys = Record<DeployCredsKey, string>;
export type DeployCredsEnvUpdates = Partial<Record<DeployCredsKey, string>>;

export type DeployEnvFileOrigin = "default" | "explicit";
export type DeployEnvFileStatus = "ok" | "missing" | "invalid";

export type DeployEnvFileInfo = {
  origin: DeployEnvFileOrigin;
  status: DeployEnvFileStatus;
  path: string;
  error?: string;
};

export type DeployCredsSource = "env" | "file" | "default" | "unset";

export type DeployCredsValues = Record<DeployCredsKey, string | undefined> & { NIX_BIN: string };

export type DeployCredsResult = {
  repoRoot: string;
  envFile?: DeployEnvFileInfo;
  envFromFile: Record<string, string>;
  values: DeployCredsValues;
  sources: Record<DeployCredsKey, DeployCredsSource>;
};

export type UpdateDeployCredsEnvFileResult = {
  envPath: string;
  runtimeDir: string;
  updatedKeys: DeployCredsKey[];
};

const DEPLOY_CREDS_ENV_DEFAULTS = Object.fromEntries(
  DEPLOY_CREDS_KEY_SPECS.map((spec) => [spec.key, spec.defaultValue]),
) as Record<DeployCredsKey, string>;

function normalizeDeployCredsValue(key: DeployCredsKey, value: unknown): string {
  const trimmed = coerceTrimmedString(value);
  const defaultValue = DEPLOY_CREDS_ENV_DEFAULTS[key];
  if (trimmed === "" && defaultValue !== "") return defaultValue;
  return trimmed;
}

function toDeployCredsEnvFileKeys(values: Record<string, unknown>): DeployCredsEnvFileKeys {
  const normalized = {} as Record<DeployCredsKey, string>;
  for (const key of DEPLOY_CREDS_KEYS) {
    normalized[key] = normalizeDeployCredsValue(key, values[key]);
  }
  return normalized;
}

export function renderDeployCredsEnvFile(keys: DeployCredsEnvFileKeys): string {
  const normalized = toDeployCredsEnvFileKeys(keys);
  const lines = [
    "# clawlets deploy creds (local-only; never commit)",
    "# Used by: bootstrap, infra, lockdown, doctor",
    "",
  ];
  for (const key of DEPLOY_CREDS_KEYS) {
    lines.push(`${key}=${formatDotenvValue(normalized[key])}`);
  }
  lines.push("");
  return lines.join("\n");
}

function trimEnv(v: unknown): string | undefined {
  const trimmed = coerceTrimmedString(v);
  return trimmed ? trimmed : undefined;
}

type DeployCredsProjectTokenEntry = { id: string; value: string };

function parseDeployCredsProjectTokenKeyring(raw: string | undefined): DeployCredsProjectTokenEntry[] {
  const json = trimEnv(raw);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const rows = Array.isArray((parsed as Record<string, unknown>).items)
    ? (parsed as Record<string, unknown>).items as unknown[]
    : [];

  const seen = new Set<string>();
  const out: DeployCredsProjectTokenEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = trimEnv((row as Record<string, unknown>).id);
    const value = trimEnv((row as Record<string, unknown>).value);
    if (!id || !value) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, value });
  }

  return out;
}

export function resolveActiveDeployCredsProjectToken(params: {
  keyringRaw: string | undefined;
  activeIdRaw: string | undefined;
}): string | undefined {
  const keyring = parseDeployCredsProjectTokenKeyring(params.keyringRaw);
  if (keyring.length === 0) return undefined;

  const activeId = trimEnv(params.activeIdRaw);
  if (!activeId) return keyring[0]?.value;
  return keyring.find((entry) => entry.id === activeId)?.value ?? keyring[0]?.value;
}

function resolveDerivedTokenSource(params: {
  keyringSource: DeployCredsSource;
  activeSource: DeployCredsSource;
}): DeployCredsSource {
  if (params.keyringSource === "env" || params.activeSource === "env") return "env";
  if (params.keyringSource === "file" || params.activeSource === "file") return "file";
  return "unset";
}

export function renderDeployCredsEnvTemplate(params: { defaultEnvPath?: string; cwd?: string } = {}): string {
  const lines = [
    "# clawlets deploy creds (local-only; never commit)",
    "# Used by: bootstrap, infra, lockdown, doctor",
    "#",
  ];
  const defaultEnvPath = trimEnv(params.defaultEnvPath);
  if (defaultEnvPath) {
    const cwd = trimEnv(params.cwd) || process.cwd();
    const rel = path.relative(cwd, defaultEnvPath) || defaultEnvPath;
    lines.push(`# Default path: ${rel}`);
  }
  lines.push("");
  for (const key of DEPLOY_CREDS_KEYS) {
    lines.push(`${key}=${formatDotenvValue(DEPLOY_CREDS_ENV_DEFAULTS[key])}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function validateDeployCredsEnvFileSecurity(
  filePath: string,
  options: { expectedUid?: number } = {},
): { ok: true } | { ok: false; error: string } {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(filePath);
  } catch (e) {
    return { ok: false, error: `cannot stat: ${String((e as Error)?.message || e)}` };
  }

  if (st.isSymbolicLink()) return { ok: false, error: "refusing to load: is a symlink" };
  if (!st.isFile()) return { ok: false, error: "refusing to load: not a regular file" };

  const badPerms = (st.mode & 0o077) !== 0;
  if (badPerms) return { ok: false, error: `refusing to load: insecure permissions (mode ${(st.mode & 0o777).toString(8)}; expected 600)` };

  const expectedUid = options.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  if (typeof expectedUid === "number" && st.uid !== expectedUid) {
    return { ok: false, error: `refusing to load: wrong owner (uid ${st.uid}; expected ${expectedUid})` };
  }

  return { ok: true };
}

function resolveEnvFile(params: { cwd: string; repoRoot: string; runtimeDir?: string; envFile?: string }):
  | { origin: DeployEnvFileOrigin; filePath: string; exists: boolean } {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);

  const explicit = trimEnv(params.envFile);
  if (explicit) {
    const expanded = expandPath(explicit);
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.cwd, expanded);
    return { origin: "explicit", filePath: abs, exists: fs.existsSync(abs) };
  }

  const abs = layout.envFilePath;
  return { origin: "default", filePath: abs, exists: fs.existsSync(abs) };
}

function readDeployCredsEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const check = validateDeployCredsEnvFileSecurity(filePath);
  if (!check.ok) throw new Error(`${check.error}: ${filePath}`);
  return dotenv.parse(fs.readFileSync(filePath, "utf8"));
}

export async function updateDeployCredsEnvFile(params: {
  repoRoot: string;
  updates: DeployCredsEnvUpdates;
  runtimeDir?: string;
  envFile?: string;
  cwd?: string;
}): Promise<UpdateDeployCredsEnvFileResult> {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const resolved = resolveEnvFile({
    cwd: params.cwd ?? params.repoRoot,
    repoRoot: params.repoRoot,
    runtimeDir: params.runtimeDir,
    envFile: params.envFile,
  });

  if (resolved.origin === "default") {
    ensurePrivateRuntimeDir(layout.runtimeDir);
  }

  const existing = toDeployCredsEnvFileKeys(readDeployCredsEnvFile(resolved.filePath));
  const next: DeployCredsEnvFileKeys = { ...existing };
  const updatedKeys: DeployCredsKey[] = [];
  for (const key of DEPLOY_CREDS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(params.updates, key)) continue;
    next[key] = normalizeDeployCredsValue(key, params.updates[key]);
    updatedKeys.push(key);
  }

  await writeFileAtomic(resolved.filePath, renderDeployCredsEnvFile(next), { mode: 0o600 });
  return {
    envPath: resolved.filePath,
    runtimeDir: layout.runtimeDir,
    updatedKeys,
  };
}

export function loadDeployCreds(params: { cwd: string; runtimeDir?: string; envFile?: string }): DeployCredsResult {
  const repoRoot = findRepoRoot(params.cwd);
  const resolved = resolveEnvFile({ cwd: params.cwd, repoRoot, runtimeDir: params.runtimeDir, envFile: params.envFile });

  let envFile: DeployEnvFileInfo | undefined;
  let envFromFile: Record<string, string> = {};

  if (resolved.exists) {
    const check = validateDeployCredsEnvFileSecurity(resolved.filePath);
    envFile = check.ok
      ? { origin: resolved.origin, status: "ok", path: resolved.filePath }
      : { origin: resolved.origin, status: "invalid", path: resolved.filePath, error: check.error };

    if (check.ok) {
      try {
        const raw = fs.readFileSync(resolved.filePath, "utf8");
        envFromFile = dotenv.parse(raw);
      } catch (e) {
        envFile = {
          origin: resolved.origin,
          status: "invalid",
          path: resolved.filePath,
          error: `cannot read/parse: ${String((e as Error)?.message || e)}`,
        };
        envFromFile = {};
      }
    }
  } else if (resolved.origin === "explicit") {
    envFile = { origin: resolved.origin, status: "missing", path: resolved.filePath, error: "file not found" };
  }

  const get = (k: DeployCredsKey): { value?: string; source: DeployCredsSource } => {
    const fromEnv = trimEnv(process.env[k]);
    if (fromEnv) return { value: fromEnv, source: "env" };

    const fromFile = trimEnv(envFromFile[k]);
    if (fromFile) return { value: fromFile, source: "file" };

    const defaultValue = DEPLOY_CREDS_ENV_DEFAULTS[k];
    if (defaultValue !== "") return { value: defaultValue, source: "default" };
    return { value: undefined, source: "unset" };
  };

  const values = {} as Record<DeployCredsKey, string | undefined>;
  const sources = {} as Record<DeployCredsKey, DeployCredsSource>;
  for (const key of DEPLOY_CREDS_KEYS) {
    const resolvedValue = get(key);
    values[key] = resolvedValue.value;
    sources[key] = resolvedValue.source;
  }

  const resolvedHcloudToken = resolveActiveDeployCredsProjectToken({
    keyringRaw: values.HCLOUD_TOKEN_KEYRING,
    activeIdRaw: values.HCLOUD_TOKEN_KEYRING_ACTIVE,
  });
  values.HCLOUD_TOKEN = resolvedHcloudToken;
  sources.HCLOUD_TOKEN = resolvedHcloudToken
    ? resolveDerivedTokenSource({
        keyringSource: sources.HCLOUD_TOKEN_KEYRING,
        activeSource: sources.HCLOUD_TOKEN_KEYRING_ACTIVE,
      })
    : "unset";

  const sopsAgeKeyFileRaw = values.SOPS_AGE_KEY_FILE ? expandPath(values.SOPS_AGE_KEY_FILE) : undefined;
  values.SOPS_AGE_KEY_FILE = sopsAgeKeyFileRaw
    ? (path.isAbsolute(sopsAgeKeyFileRaw) ? sopsAgeKeyFileRaw : path.resolve(repoRoot, sopsAgeKeyFileRaw))
    : undefined;

  return {
    repoRoot,
    envFile,
    envFromFile,
    values: {
      ...(values as Record<DeployCredsKey, string | undefined>),
      NIX_BIN: values.NIX_BIN || DEPLOY_CREDS_ENV_DEFAULTS.NIX_BIN || "nix",
    },
    sources,
  };
}
