import path from "node:path"
import fs from "node:fs"
import crypto from "node:crypto"

import { createServerFn } from "@tanstack/react-start"
import {
  loadDeployCreds,
  DEPLOY_CREDS_KEYS,
  isDeployCredsSecretKey,
  renderDeployCredsEnvTemplate,
  updateDeployCredsEnvFile,
  type DeployCredsEnvFileKeys,
} from "@clawlets/core/lib/infra/deploy-creds"
import { getRepoLayout } from "@clawlets/core/repo-layout"
import { ensureDir, writeFileAtomic } from "@clawlets/core/lib/storage/fs-safe"
import { ageKeygen } from "@clawlets/core/lib/security/age-keygen"
import { parseAgeKeyFile } from "@clawlets/core/lib/security/age"
import { getLocalOperatorAgeKeyPath } from "@clawlets/core/repo-layout"
import { sanitizeOperatorId } from "@clawlets/shared/lib/identifiers"
import os from "node:os"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { getRepoRoot } from "~/sdk/project"
import { parseProjectIdInput } from "~/sdk/runtime"

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function toAuditDocPath(repoRoot: string, absPath: string, fallback: string): string {
  const rel = path.relative(repoRoot, absPath)
  const normalized = rel.split(path.sep).join("/")
  if (!normalized || normalized === "." || normalized === "..") return fallback
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) return fallback
  if (path.isAbsolute(normalized)) return fallback
  return normalized
}

export type DeployCredsStatusKey = {
  key: string
  source: "env" | "file" | "default" | "unset"
  status: "set" | "unset"
  value?: string
}

export type DeployCredsStatus = {
  repoRoot: string
  envFile:
    | null
    | {
        origin: "default" | "explicit"
        status: "ok" | "missing" | "invalid"
        path: string
        error?: string
      }
  defaultEnvPath: string
  defaultSopsAgeKeyPath: string
  keys: DeployCredsStatusKey[]
  template: string
}

export const getDeployCredsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })
    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const defaultSopsAgeKeyPath = getLocalOperatorAgeKeyPath(layout, operatorId)

    const keys: DeployCredsStatusKey[] = DEPLOY_CREDS_KEYS.map((key) => {
      const source = loaded.sources[key]
      const value = loaded.values[key]
      const isSecret = isDeployCredsSecretKey(key)
      const status = value ? "set" : "unset"
      if (isSecret) return { key, source, status }
      return { key, source, status, value: value ? String(value) : undefined }
    })

    return {
      repoRoot,
      envFile: loaded.envFile ? { ...loaded.envFile } : null,
      defaultEnvPath: layout.envFilePath,
      defaultSopsAgeKeyPath,
      keys,
      template: renderDeployCredsEnvTemplate({ defaultEnvPath: layout.envFilePath, cwd: repoRoot }),
    } satisfies DeployCredsStatus
  })

export const updateDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const updatesRaw = d["updates"]
    const updates = (!updatesRaw || typeof updatesRaw !== "object" || Array.isArray(updatesRaw))
      ? {}
      : (updatesRaw as Record<string, unknown>)

    const out: Partial<DeployCredsEnvFileKeys> = {}
    for (const k of DEPLOY_CREDS_KEYS) {
      if (!(k in updates)) continue
      const v = updates[k]
      if (typeof v !== "string") throw new Error(`invalid updates.${k}`)
      out[k] = v
    }

    return { ...base, updates: out }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const writeResult = await updateDeployCredsEnvFile({ repoRoot, updates: data.updates })

    const envDoc = toAuditDocPath(repoRoot, writeResult.envPath, ".clawlets/env")
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "deployCreds.update",
      target: { doc: envDoc },
      data: {
        updatedKeys: writeResult.updatedKeys,
      },
    })

    return { ok: true as const }
  })

type KeyCandidate = {
  path: string
  exists: boolean
  valid: boolean
  reason?: string
}

export const detectSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })

    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const defaultOperatorPath = getLocalOperatorAgeKeyPath(layout, operatorId)
    const home = os.homedir()
    const homePaths = [
      path.join(home, ".config", "sops", "age", "keys.txt"),
      path.join(home, ".sops", "age", "keys.txt"),
    ]

    const candidates: string[] = []
    if (loaded.values.SOPS_AGE_KEY_FILE) candidates.push(String(loaded.values.SOPS_AGE_KEY_FILE))
    candidates.push(defaultOperatorPath)
    if (fs.existsSync(layout.localOperatorKeysDir)) {
      for (const entry of fs.readdirSync(layout.localOperatorKeysDir)) {
        if (!entry.endsWith(".agekey")) continue
        candidates.push(path.join(layout.localOperatorKeysDir, entry))
      }
    }
    for (const p of homePaths) candidates.push(p)

    const seen = new Set<string>()
    const results: KeyCandidate[] = []
    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      if (!fs.existsSync(resolved)) {
        results.push({ path: resolved, exists: false, valid: false, reason: "missing" })
        continue
      }
      const st = fs.lstatSync(resolved)
      if (st.isSymbolicLink()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "symlink blocked" })
        continue
      }
      if (!st.isFile()) {
        results.push({ path: resolved, exists: true, valid: false, reason: "not a file" })
        continue
      }
      const parsed = parseAgeKeyFile(fs.readFileSync(resolved, "utf8"))
      if (!parsed.secretKey) {
        results.push({ path: resolved, exists: true, valid: false, reason: "invalid key file" })
        continue
      }
      results.push({ path: resolved, exists: true, valid: true })
    }

    const preferred =
      results.find((r) => r.valid && r.path === String(loaded.values.SOPS_AGE_KEY_FILE || "")) ||
      results.find((r) => r.valid && r.path === defaultOperatorPath) ||
      results.find((r) => r.valid) ||
      null

    return {
      operatorId,
      defaultOperatorPath,
      candidates: results,
      recommendedPath: preferred?.path || null,
    }
  })

export const generateSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const operatorId = sanitizeOperatorId(String(process.env.USER || "operator"))
    const keyPath = getLocalOperatorAgeKeyPath(layout, operatorId)
    const pubPath = `${keyPath}.pub`

    if (fs.existsSync(keyPath)) {
      return { ok: false as const, message: `key already exists: ${keyPath}` }
    }

    await ensureDir(layout.localOperatorKeysDir)
    try {
      fs.chmodSync(layout.localOperatorKeysDir, 0o700)
    } catch {
      // best-effort
    }

    const loaded = loadDeployCreds({ cwd: repoRoot })
    const nixBin = String(loaded.values.NIX_BIN || "nix").trim() || "nix"
    const keypair = await ageKeygen({ nixBin, cwd: repoRoot })

    await writeFileAtomic(keyPath, keypair.fileText, { mode: 0o600 })
    await writeFileAtomic(pubPath, `${keypair.publicKey}\n`, { mode: 0o600 })

    await updateDeployCredsEnvFile({
      repoRoot,
      updates: {
        SOPS_AGE_KEY_FILE: keyPath,
      },
    })

    const operatorKeysDoc = toAuditDocPath(repoRoot, layout.localOperatorKeysDir, ".clawlets/keys/operators")
    const operatorIdHash = `sha256:${sha256Hex(`${data.projectId}:${operatorId}`)}`
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "sops.operatorKey.generate",
      target: { doc: operatorKeysDoc },
      data: { operatorIdHash },
    })

    return { ok: true as const, keyPath, publicKey: keypair.publicKey }
  })
