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

describe("secrets write runner queue", () => {
  it("reserves and finalizes secrets write with sealed payload", async () => {
    vi.resetModules()
    const mutation: any = vi.fn(async (_mutation: unknown, _payload?: unknown) => null)
    mutation
      .mockResolvedValueOnce({
        runId: "run1",
        jobId: "job1",
        kind: "secrets_write",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "kid123",
      })
      .mockResolvedValueOnce({ runId: "run1", jobId: "job1" })
      .mockResolvedValueOnce(null)
    const query = vi.fn(async () => ({ role: "admin" }))

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))

    const mod = await import("~/sdk/secrets")
    const reserve = await runWithStartContext(startContext, async () =>
      await mod.writeHostSecrets({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          secretNames: ["DISCORD_TOKEN"],
          targetRunnerId: "r1",
        },
      }),
    )
    expect(reserve.ok).toBe(true)
    expect(reserve.reserved).toBe(true)
    expect(reserve.jobId).toBe("job1")
    expect(reserve.kind).toBe("secrets_write")

    const res = await runWithStartContext(startContext, async () =>
      await mod.writeHostSecretsFinalize({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          jobId: "job1" as any,
          kind: "secrets_write",
          secretNames: ["DISCORD_TOKEN"],
          targetRunnerId: "r1",
          sealedInputB64: "ciphertext",
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid123",
        },
      }),
    )

    expect(res.ok).toBe(true)
    expect(res.queued).toBe(true)
    expect(res.runId).toBe("run1")
    expect(res.jobId).toBe("job1")

    const reservePayload = mutation.mock.calls[0]?.[1]
    expect(reservePayload).toMatchObject({
      projectId: "p1",
      kind: "secrets_write",
      targetRunnerId: "r1",
    })
    const auditPayload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "secrets.write")?.[1]
    expect(auditPayload).toEqual({
      projectId: "p1",
      action: "secrets.write",
      target: { host: "alpha" },
      data: { runId: "run1", jobId: "job1", targetRunnerId: "r1", secrets: ["DISCORD_TOKEN"] },
    })
  })
})
