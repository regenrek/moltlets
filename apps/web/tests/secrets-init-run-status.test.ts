import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

const startContext = {
  request: new Request("http://localhost"),
  contextAfterGlobalMiddlewares: {},
  executedRequestMiddlewares: new Set(),
}

describe("secrets init execute queueing", () => {
  it("reserves secrets init sealed-input job", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => ({
      runId: "run1",
      jobId: "job1",
      kind: "secrets_init",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid123",
    }))
    const query = vi.fn(async () => ({
      role: "admin",
      run: { projectId: "p1", kind: "secrets_init", status: "running" },
    }))

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))

    const mod = await import("~/sdk/secrets")
    const res = await runWithStartContext(startContext, async () =>
      await mod.secretsInitExecute({
        data: {
          projectId: "p1" as any,
          runId: "run1" as any,
          host: "alpha",
          scope: "bootstrap",
          allowPlaceholders: true,
          secretNames: ["DISCORD_TOKEN"],
          targetRunnerId: "r1",
        },
      }),
    )

    expect(res.ok).toBe(true)
    expect(res.reserved).toBe(true)
    expect(res.jobId).toBe("job1")
    expect(mutation).toHaveBeenCalledTimes(2)
    const auditPayload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "secrets.init")?.[1]
    expect(auditPayload).toEqual({
      projectId: "p1",
      action: "secrets.init",
      target: { host: "alpha" },
      data: { runId: "run1", jobId: "job1", targetRunnerId: "r1", scope: "bootstrap" },
    })
  })

  it("finalizes reserved secrets init job with sealed payload", async () => {
    vi.resetModules()
    const mutation: any = vi.fn(async (_mutation: unknown, _payload?: unknown) => null)
    mutation
      .mockResolvedValueOnce({
        runId: "run1",
        jobId: "job1",
        kind: "secrets_init",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "kid123",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ runId: "run1", jobId: "job1" })
    const query = vi.fn(async () => ({
      role: "admin",
      run: { projectId: "p1", kind: "secrets_init", status: "running" },
    }))

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))

    const mod = await import("~/sdk/secrets")
    const reserved = await runWithStartContext(startContext, async () =>
      await mod.secretsInitExecute({
        data: {
          projectId: "p1" as any,
          runId: "run1" as any,
          host: "alpha",
          scope: "all",
          allowPlaceholders: false,
          secretNames: ["DISCORD_TOKEN"],
          targetRunnerId: "r1",
        },
      }),
    )
    const queued = await runWithStartContext(startContext, async () =>
      await mod.secretsInitFinalize({
        data: {
          projectId: "p1" as any,
          jobId: reserved.jobId,
          kind: reserved.kind,
          sealedInputB64: "ciphertext",
          sealedInputAlg: reserved.sealedInputAlg,
          sealedInputKeyId: reserved.sealedInputKeyId,
        },
      }),
    )

    expect(queued).toEqual({ runId: "run1", jobId: "job1" })
  })
})
