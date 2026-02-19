import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, generateKeyPairSync } from "node:crypto"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function makeRunnerKeyMaterial() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
  const spki = pair.publicKey.export({ type: "spki", format: "der" })
  const spkiBuf = Buffer.isBuffer(spki) ? spki : Buffer.from(spki)
  return {
    keyId: toBase64Url(createHash("sha256").update(spkiBuf).digest()),
    publicKeySpkiB64: toBase64Url(spkiBuf),
  }
}

async function loadSdk() {
  vi.resetModules()
  const runnerKeyMaterial = makeRunnerKeyMaterial()

  const mutation: any = vi.fn(async (_mutation: unknown, payload?: any) => {
    if (
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.targetRunnerId === "string"
      && typeof payload.kind === "string"
      && payload.payloadMeta
    ) {
      return {
        runId: "run_1",
        jobId: "job_1",
        kind: "custom",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: runnerKeyMaterial.keyId,
        sealedInputPubSpkiB64: runnerKeyMaterial.publicKeySpkiB64,
      }
    }
    if (
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.jobId === "string"
      && typeof payload.kind === "string"
      && typeof payload.sealedInputB64 === "string"
    ) {
      return { runId: "run_1", jobId: payload.jobId }
    }
    const maybeTakeResult =
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.jobId === "string"
      && !("kind" in payload)
      && !("sealedInputB64" in payload)
    if (maybeTakeResult) {
      return {
        runId: "run_1",
        resultJson: JSON.stringify({
          ok: true,
          keyPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
          publicKey: "age1test",
        }),
      }
    }
    return null
  })
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand: async () => ({ runId: "run_1", jobId: "job_1" }),
      waitForRunTerminal: async () => ({ status: "succeeded" }),
      listRunMessages: async () => [
        JSON.stringify({
          ok: true,
          keyPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
          publicKey: "age1test",
        }),
      ],
      parseLastJsonMessage: (messages: string[]) => {
        const raw = messages[messages.length - 1] || "{}"
        return JSON.parse(raw)
      },
      lastErrorMessage: () => "runner command failed",
    }
  })
  vi.doMock("~/sdk/project", () => ({
    getRepoRoot: async () => "/tmp/repo",
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("@clawlets/core/lib/storage/fs-safe", () => ({
    ensureDir: async () => {},
    writeFileAtomic: async () => {},
  }))
  vi.doMock("@clawlets/core/lib/security/age-keygen", () => ({
    ageKeygen: async () => ({ fileText: "AGE-SECRET-KEY-1TEST", publicKey: "age1test" }),
  }))
  vi.doMock("@clawlets/core/lib/infra/deploy-creds", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@clawlets/core/lib/infra/deploy-creds")>()
    return {
      ...actual,
      loadDeployCreds: () =>
        ({
          repoRoot: "/tmp/repo",
          envFromFile: {},
          values: { NIX_BIN: "nix" },
          sources: {},
        }) as any,
      updateDeployCredsEnvFile: async () => ({
        envPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/env",
        runtimeDir: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef",
        updatedKeys: ["HCLOUD_TOKEN"],
      }),
    }
  })

  const mod = await import("~/sdk/infra/deploy-creds")
  return { mod, mutation }
}

describe("audit pii minimization", () => {
  it("uses metadata-only audit payloads for deploy creds and operator keys", async () => {
    const previousUser = process.env.USER
    process.env.USER = "alice"
    try {
      const { mod, mutation } = await loadSdk()
      const ctx = {
        request: new Request("http://localhost"),
        contextAfterGlobalMiddlewares: {},
        executedRequestMiddlewares: new Set(),
      }

      await runWithStartContext(ctx, async () => {
        await mod.queueDeployCredsUpdate({
          data: {
            projectId: "p1" as any,
            targetRunnerId: "r1",
            updates: { HCLOUD_TOKEN: "token-123" },
          },
        })
      })
      await runWithStartContext(ctx, async () =>
        mod.generateSopsAgeKey({
          data: { projectId: "p1" as any },
        }),
      )

      const payloads = mutation.mock.calls.map((call: any[]) => call[1] as any)
      const deploy = payloads.find((p: any) => p?.action === "deployCreds.update")
      const operator = payloads.find((p: any) => p?.action === "sops.operatorKey.generate")

      expect(deploy).toBeTruthy()
      expect(deploy.target).toEqual({ doc: "<runtimeDir>/env" })
      expect(deploy.data).toEqual({
        runId: "run_1",
        jobId: "job_1",
        targetRunnerId: "r1",
        updatedKeys: ["HCLOUD_TOKEN"],
      })
      expect(deploy.target?.envPath).toBeUndefined()
      expect(deploy.data?.runtimeDir).toBeUndefined()

      expect(operator).toBeTruthy()
      expect(operator.target).toEqual({ doc: "<runtimeDir>/keys/operators" })
      expect(operator.data?.operatorId).toBeUndefined()
      expect(operator.data?.operatorIdHash).toBeUndefined()
      expect(operator.data).toEqual({
        runId: "run_1",
      })
    } finally {
      if (previousUser === undefined) delete process.env.USER
      else process.env.USER = previousUser
    }
  })
})
