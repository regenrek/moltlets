import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

async function loadSdk() {
  vi.resetModules()

  const mutation = vi.fn(async (_mutation: unknown, _payload?: unknown) => null)
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
          keyPath: "/tmp/repo/.clawlets/keys/operators/alice.agekey",
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
        envPath: "/tmp/repo/.clawlets/env",
        runtimeDir: "/tmp/repo/.clawlets",
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

      await runWithStartContext(ctx, async () =>
        mod.updateDeployCreds({
          data: { projectId: "p1" as any, updatedKeys: ["HCLOUD_TOKEN"] },
        }),
      )
      await runWithStartContext(ctx, async () =>
        mod.generateSopsAgeKey({
          data: { projectId: "p1" as any },
        }),
      )

      const payloads = mutation.mock.calls.map(([, payload]) => payload as any)
      const deploy = payloads.find((p) => p?.action === "deployCreds.update")
      const operator = payloads.find((p) => p?.action === "sops.operatorKey.generate")

      expect(deploy).toBeTruthy()
      expect(deploy.target).toEqual({ doc: ".clawlets/env" })
      expect(deploy.data).toEqual({ runId: "run_1", updatedKeys: ["HCLOUD_TOKEN"] })
      expect(deploy.target?.envPath).toBeUndefined()
      expect(deploy.data?.runtimeDir).toBeUndefined()

      expect(operator).toBeTruthy()
      expect(operator.target).toEqual({ doc: ".clawlets/keys/operators" })
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
