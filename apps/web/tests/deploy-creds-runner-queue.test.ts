import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

async function loadSdk(params: { runnerJson: Record<string, unknown>; runners?: unknown[] }) {
  vi.resetModules()
  const mutation = vi.fn(async (..._args: any[]) => null)
  const query = vi.fn(async () => params.runners || [])
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    getRepoRoot: async () => "/tmp/repo",
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand: async () => ({ runId: "run_1", jobId: "job_1" }),
      waitForRunTerminal: async () => ({ status: "succeeded" }),
      listRunMessages: async () => [JSON.stringify(params.runnerJson)],
      parseLastJsonMessage: (messages: string[]) => {
        const raw = messages[messages.length - 1] || "{}"
        return JSON.parse(raw)
      },
      lastErrorMessage: () => "runner command failed",
    }
  })

  const mod = await import("~/sdk/infra/deploy-creds")
  return { mod, mutation, query }
}

describe("deploy creds runner queue", () => {
  it("reads deploy creds status from runner JSON", async () => {
    const { mod } = await loadSdk({
      runnerJson: {
        repoRoot: "/tmp/repo",
        envFile: { origin: "default", status: "ok", path: "/tmp/repo/.clawlets/env" },
        defaultEnvPath: "/tmp/repo/.clawlets/env",
        defaultSopsAgeKeyPath: "/tmp/repo/.clawlets/keys/operators/alice.agekey",
        keys: [{ key: "HCLOUD_TOKEN", source: "file", status: "set" }],
        template: "template",
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.getDeployCredsStatus({
        data: { projectId: "p1" as any },
      }),
    )
    expect(res.defaultEnvPath).toBe("/tmp/repo/.clawlets/env")
    expect(res.keys).toEqual([{ key: "HCLOUD_TOKEN", source: "file", status: "set" }])
  })

  it("reads detected age key candidates from runner JSON", async () => {
    const { mod } = await loadSdk({
      runnerJson: {
        operatorId: "alice",
        defaultOperatorPath: "/tmp/repo/.clawlets/keys/operators/alice.agekey",
        candidates: [{ path: "/tmp/repo/.clawlets/keys/operators/alice.agekey", exists: true, valid: true }],
        recommendedPath: "/tmp/repo/.clawlets/keys/operators/alice.agekey",
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.detectSopsAgeKey({
        data: { projectId: "p1" as any },
      }),
    )
    expect(res.recommendedPath).toBe("/tmp/repo/.clawlets/keys/operators/alice.agekey")
    expect(res.candidates[0]?.valid).toBe(true)
  })

  it("records audit metadata after runner age-key generation", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        ok: true,
        keyPath: "/tmp/repo/.clawlets/keys/operators/alice.agekey",
        publicKey: "age1test",
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.generateSopsAgeKey({
        data: { projectId: "p1" as any },
      }),
    )
    expect(res.ok).toBe(true)
    const payload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "sops.operatorKey.generate")?.[1]
    expect(payload).toEqual({
      projectId: "p1",
      action: "sops.operatorKey.generate",
      target: { doc: ".clawlets/keys/operators" },
      data: { runId: "run_1" },
    })
  })

  it("queues deploy-creds update and returns local submit config", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {},
      runners: [
        {
          runnerName: "runner-1",
          lastSeenAt: 100,
          lastStatus: "online",
          capabilities: {
            supportsLocalSecretsSubmit: true,
            localSecretsPort: 43110,
            localSecretsNonce: "nonce-123",
          },
        },
      ],
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.updateDeployCreds({
        data: { projectId: "p1" as any, updatedKeys: ["HCLOUD_TOKEN"] },
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.localSubmitRequired).toBe(true)
    expect(res.localSubmit).toEqual({ port: 43110, nonce: "nonce-123" })
    const payload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "deployCreds.update")?.[1]
    expect(payload).toEqual({
      projectId: "p1",
      action: "deployCreds.update",
      target: { doc: ".clawlets/env" },
      data: { runId: "run_1", updatedKeys: ["HCLOUD_TOKEN"] },
    })
  })
})
