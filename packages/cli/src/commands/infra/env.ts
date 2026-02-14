import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { ensureDir, writeFileAtomic } from "@clawlets/core/lib/storage/fs-safe";
import { parseDotenv } from "@clawlets/core/lib/storage/dotenv-file";
import { expandPath } from "@clawlets/core/lib/storage/path-expand";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import {
  DEPLOY_CREDS_KEYS,
  isDeployCredsSecretKey,
  loadDeployCreds,
  renderDeployCredsEnvFile,
  renderDeployCredsEnvTemplate,
  updateDeployCredsEnvFile,
  type DeployCredsEnvFileKeys,
} from "@clawlets/core/lib/infra/deploy-creds";
import { getLocalOperatorAgeKeyPath, getRepoLayout } from "@clawlets/core/repo-layout";
import { parseAgeKeyFile } from "@clawlets/core/lib/security/age";
import { ageKeygen } from "@clawlets/core/lib/security/age-keygen";
import { sanitizeOperatorId } from "@clawlets/shared/lib/identifiers";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

function resolveEnvFilePath(params: { cwd: string; runtimeDir?: string; envFileArg?: unknown }): { path: string; origin: "default" | "explicit" } {
  const repoRoot = findRepoRoot(params.cwd);
  const explicit = coerceTrimmedString(params.envFileArg);
  if (explicit) {
    const expanded = expandPath(explicit);
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.cwd, expanded);
    return { path: abs, origin: "explicit" };
  }
  const layout = getRepoLayout(repoRoot, params.runtimeDir);
  return { path: layout.envFilePath, origin: "default" };
}

function readEnvFileOrEmpty(filePath: string): { text: string; parsed: Record<string, string> } {
  if (!fs.existsSync(filePath)) return { text: "", parsed: {} };
  const st = fs.lstatSync(filePath);
  if (st.isSymbolicLink()) throw new Error(`refusing to read env file symlink: ${filePath}`);
  if (!st.isFile()) throw new Error(`refusing to read non-file env path: ${filePath}`);
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = parseDotenv(text);
  return { text, parsed };
}

type DeployCredsStatusKey = {
  key: string;
  source: "env" | "file" | "default" | "unset";
  status: "set" | "unset";
  value?: string;
};

type DeployCredsStatusJson = {
  repoRoot: string;
  envFile:
    | null
    | {
        origin: "default" | "explicit";
        status: "ok" | "missing" | "invalid";
        path: string;
        error?: string;
      };
  defaultEnvPath: string;
  defaultSopsAgeKeyPath: string;
  keys: DeployCredsStatusKey[];
  template: string;
};

type KeyCandidate = {
  path: string;
  exists: boolean;
  valid: boolean;
  reason?: string;
};

function buildDeployCredsStatus(params: { cwd: string; runtimeDir?: string; envFile?: string }): DeployCredsStatusJson {
  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot, params.runtimeDir);
  const loaded = loadDeployCreds({ cwd: params.cwd, runtimeDir: params.runtimeDir, envFile: params.envFile });
  const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"));
  const defaultSopsAgeKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
  const keys: DeployCredsStatusKey[] = DEPLOY_CREDS_KEYS.map((key) => {
    const source = loaded.sources[key];
    const value = loaded.values[key];
    const status = value ? "set" : "unset";
    if (isDeployCredsSecretKey(key)) return { key, source, status };
    return { key, source, status, value: value ? String(value) : undefined };
  });
  return {
    repoRoot,
    envFile: loaded.envFile ? { ...loaded.envFile } : null,
    defaultEnvPath: layout.envFilePath,
    defaultSopsAgeKeyPath,
    keys,
    template: renderDeployCredsEnvTemplate({ defaultEnvPath: layout.envFilePath, cwd: repoRoot }),
  };
}

export const envInit = defineCommand({
  meta: {
    name: "init",
    description: "Create/update <runtimeDir>/env for deploy creds (gitignored).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file path override (advanced; default: <runtimeDir>/env)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const layout = getRepoLayout(repoRoot, (args as any).runtimeDir);
    const resolved = resolveEnvFilePath({ cwd, runtimeDir: (args as any).runtimeDir, envFileArg: (args as any).envFile });

    if (resolved.origin === "default") {
      try {
        fs.mkdirSync(layout.runtimeDir, { recursive: true });
        fs.chmodSync(layout.runtimeDir, 0o700);
      } catch {
        // best-effort on platforms without POSIX perms
      }
    }

    const existing = readEnvFileOrEmpty(resolved.path).parsed;
    const keys: DeployCredsEnvFileKeys = {
      HCLOUD_TOKEN: String(existing.HCLOUD_TOKEN || "").trim(),
      GITHUB_TOKEN: String(existing.GITHUB_TOKEN || "").trim(),
      NIX_BIN: String(existing.NIX_BIN || "nix").trim() || "nix",
      SOPS_AGE_KEY_FILE: String(existing.SOPS_AGE_KEY_FILE || "").trim(),
      AWS_ACCESS_KEY_ID: String(existing.AWS_ACCESS_KEY_ID || "").trim(),
      AWS_SECRET_ACCESS_KEY: String(existing.AWS_SECRET_ACCESS_KEY || "").trim(),
      AWS_SESSION_TOKEN: String(existing.AWS_SESSION_TOKEN || "").trim(),
    };

    await writeFileAtomic(resolved.path, renderDeployCredsEnvFile(keys), { mode: 0o600 });

    console.log(`ok: wrote ${path.relative(repoRoot, resolved.path) || resolved.path}`);
    if (resolved.origin === "explicit") {
      console.log(`note: pass --env-file ${resolved.path} to commands that read deploy creds (bootstrap/infra/lockdown/...).`);
    } else {
      console.log("next: edit this file and set HCLOUD_TOKEN (required)");
    }
  },
});

export const envShow = defineCommand({
  meta: {
    name: "show",
    description: "Show resolved deploy creds (redacted) + their sources (env/file/default).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const runtimeDir = (args as any).runtimeDir as string | undefined;
    const envFile = (args as any).envFile as string | undefined;
    const status = buildDeployCredsStatus({ cwd, runtimeDir, envFile });
    if ((args as any).json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    const loaded = loadDeployCreds({ cwd, runtimeDir, envFile });

    if (loaded.envFile) {
      const status = loaded.envFile.status;
      const detail = loaded.envFile.error ? ` (${loaded.envFile.error})` : "";
      console.log(`env file: ${status} (${loaded.envFile.origin}) ${loaded.envFile.path}${detail}`);
    } else {
      console.log("env file: (default missing; set vars via process env or run: clawlets env init)");
    }

    const line = (
      k:
        | "HCLOUD_TOKEN"
        | "GITHUB_TOKEN"
        | "NIX_BIN"
        | "SOPS_AGE_KEY_FILE"
        | "AWS_ACCESS_KEY_ID"
        | "AWS_SECRET_ACCESS_KEY"
        | "AWS_SESSION_TOKEN",
      redact: boolean,
    ) => {
      const v = loaded.values[k];
      const src = loaded.sources[k];
      if (!v) return `${k}: unset (${src})`;
      if (redact) return `${k}: set (${src})`;
      return `${k}: ${v} (${src})`;
    };

    console.log(line("HCLOUD_TOKEN", true));
    console.log(line("GITHUB_TOKEN", true));
    console.log(line("NIX_BIN", false));
    console.log(line("SOPS_AGE_KEY_FILE", false));
    console.log(line("AWS_ACCESS_KEY_ID", true));
    console.log(line("AWS_SECRET_ACCESS_KEY", true));
    console.log(line("AWS_SESSION_TOKEN", true));
  },
});

export const envDetectAgeKey = defineCommand({
  meta: {
    name: "detect-age-key",
    description: "Detect candidate SOPS age key files and print recommendation.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const runtimeDir = (args as any).runtimeDir as string | undefined;
    const envFile = (args as any).envFile as string | undefined;
    const repoRoot = findRepoRoot(cwd);
    const layout = getRepoLayout(repoRoot, runtimeDir);
    const loaded = loadDeployCreds({ cwd, runtimeDir, envFile });

    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"));
    const defaultOperatorPath = getLocalOperatorAgeKeyPath(layout, operatorId);

    const candidates: string[] = [];
    if (loaded.values.SOPS_AGE_KEY_FILE) candidates.push(String(loaded.values.SOPS_AGE_KEY_FILE));
    candidates.push(defaultOperatorPath);
    if (fs.existsSync(layout.localOperatorKeysDir)) {
      for (const entry of fs.readdirSync(layout.localOperatorKeysDir)) {
        if (!entry.endsWith(".agekey")) continue;
        candidates.push(path.join(layout.localOperatorKeysDir, entry));
      }
    }

    const seen = new Set<string>();
    const results: KeyCandidate[] = [];
    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (!fs.existsSync(resolved)) {
        results.push({ path: resolved, exists: false, valid: false, reason: "missing" });
        continue;
      }
      const st = fs.lstatSync(resolved);
      if (st.isSymbolicLink()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "symlink blocked" });
        continue;
      }
      if (!st.isFile()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "not a file" });
        continue;
      }
      const parsed = parseAgeKeyFile(fs.readFileSync(resolved, "utf8"));
      if (!parsed.secretKey) {
        results.push({ path: resolved, exists: true, valid: false, reason: "invalid key file" });
        continue;
      }
      results.push({ path: resolved, exists: true, valid: true });
    }

    const preferred =
      results.find((r) => r.valid && r.path === String(loaded.values.SOPS_AGE_KEY_FILE || "")) ||
      results.find((r) => r.valid && r.path === defaultOperatorPath) ||
      results.find((r) => r.valid) ||
      null;

    const out = {
      operatorId,
      defaultOperatorPath,
      candidates: results,
      recommendedPath: preferred?.path || null,
    };
    if ((args as any).json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    console.log(`operator: ${operatorId}`);
    console.log(`default: ${defaultOperatorPath}`);
    if (out.recommendedPath) console.log(`recommended: ${out.recommendedPath}`);
    else console.log("recommended: none");
  },
});

export const envGenerateAgeKey = defineCommand({
  meta: {
    name: "generate-age-key",
    description: "Generate local operator age key and set SOPS_AGE_KEY_FILE.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const runtimeDir = (args as any).runtimeDir as string | undefined;
    const envFile = (args as any).envFile as string | undefined;
    const repoRoot = findRepoRoot(cwd);
    const layout = getRepoLayout(repoRoot, runtimeDir);
    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"));
    const keyPath = getLocalOperatorAgeKeyPath(layout, operatorId);
    const pubPath = `${keyPath}.pub`;
    const loaded = loadDeployCreds({ cwd, runtimeDir, envFile });

    if (fs.existsSync(keyPath)) {
      const parsed = parseAgeKeyFile(fs.readFileSync(keyPath, "utf8"));
      if (!parsed.secretKey || !parsed.publicKey) {
        const invalid = {
          ok: false as const,
          message: `existing key file invalid: ${keyPath}; fix/remove then retry generate`,
        };
        if ((args as any).json) {
          console.log(JSON.stringify(invalid, null, 2));
        } else {
          console.log(invalid.message);
        }
        return;
      }
      await updateDeployCredsEnvFile({
        repoRoot,
        runtimeDir,
        envFile,
        updates: {
          SOPS_AGE_KEY_FILE: keyPath,
        },
      });
      const existing = {
        ok: true as const,
        keyPath,
        publicKey: parsed.publicKey,
        created: false as const,
      };
      if ((args as any).json) {
        console.log(JSON.stringify(existing, null, 2));
      } else {
        console.log(`ok: using existing ${keyPath}`);
      }
      return;
    }

    await ensureDir(layout.localOperatorKeysDir);
    try {
      fs.chmodSync(layout.localOperatorKeysDir, 0o700);
    } catch {
      // best-effort
    }

    const nixBin = String(loaded.values.NIX_BIN || "nix").trim() || "nix";
    const keypair = await ageKeygen({ nixBin, cwd: repoRoot });

    await writeFileAtomic(keyPath, keypair.fileText, { mode: 0o600 });
    await writeFileAtomic(pubPath, `${keypair.publicKey}\n`, { mode: 0o600 });
    await updateDeployCredsEnvFile({
      repoRoot,
      runtimeDir,
      envFile,
      updates: {
        SOPS_AGE_KEY_FILE: keyPath,
      },
    });

    const out = { ok: true as const, keyPath, publicKey: keypair.publicKey, created: true as const };
    if ((args as any).json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    console.log(`ok: generated ${keyPath}`);
  },
});

export const envApplyJson = defineCommand({
  meta: {
    name: "apply-json",
    description: "Apply deploy creds updates from a JSON object file.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    fromJson: { type: "string", required: true, description: "Path to JSON object with deploy creds keys." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const runtimeDir = (args as any).runtimeDir as string | undefined;
    const envFile = (args as any).envFile as string | undefined;
    const repoRoot = findRepoRoot(cwd);
    const fromJsonRaw = String((args as any).fromJson || "").trim();
    if (!fromJsonRaw) throw new Error("missing --from-json");
    const fromJsonPath = path.isAbsolute(fromJsonRaw) ? fromJsonRaw : path.resolve(cwd, fromJsonRaw);
    const text = fs.readFileSync(fromJsonPath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid --from-json payload (expected JSON object)");
    }
    const updates: Partial<DeployCredsEnvFileKeys> = {};
    for (const key of DEPLOY_CREDS_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value !== "string") continue;
      updates[key] = value;
    }
    const updatedKeys = Object.keys(updates);
    if (updatedKeys.length === 0) {
      throw new Error("no deploy creds keys found in --from-json payload");
    }
    const writeResult = await updateDeployCredsEnvFile({
      repoRoot,
      runtimeDir,
      envFile,
      updates,
    });
    const out = {
      ok: true as const,
      envPath: writeResult.envPath,
      updatedKeys: writeResult.updatedKeys,
    };
    if ((args as any).json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    console.log(`ok: updated ${out.updatedKeys.join(", ")}`);
  },
});

export const env = defineCommand({
  meta: {
    name: "env",
    description: "Local deploy credentials (.clawlets/env).",
  },
  subCommands: {
    init: envInit,
    show: envShow,
    "detect-age-key": envDetectAgeKey,
    "generate-age-key": envGenerateAgeKey,
    "apply-json": envApplyJson,
  },
});
