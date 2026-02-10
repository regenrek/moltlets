import { describe, expect, it, vi } from "vitest"

import {
  __test_finalizeSealedEnqueueInternalHandler,
  __test_leaseNextInternalHandler,
} from "../convex/controlPlane/jobs"

function makeCtx(params: { jobs: any[]; runs: any[] }) {
  const jobs = new Map<string, any>(params.jobs.map((row) => [String(row._id), { ...row }]))
  const runs = new Map<string, any>(params.runs.map((row) => [String(row._id), { ...row }]))

  const ctx = {
    db: {
      get: async (id: string) => {
        const key = String(id)
        if (jobs.has(key)) return jobs.get(key)
        if (runs.has(key)) return runs.get(key)
        return null
      },
      query: (table: "jobs" | "runs") => ({
        withIndex: (_name: string, fn: any) => {
          const eqFilters: Record<string, any> = {}
          const lteFilters: Record<string, number> = {}
          const q: any = {
            eq: (field: string, value: any) => {
              eqFilters[field] = value
              return q
            },
            lte: (field: string, value: number) => {
              lteFilters[field] = value
              return q
            },
          }
          fn(q)
          const filtered = () => {
            const source = table === "jobs" ? [...jobs.values()] : [...runs.values()]
            return source.filter((row) => {
              for (const [field, value] of Object.entries(eqFilters)) {
                if ((row as any)[field] !== value) return false
              }
              for (const [field, value] of Object.entries(lteFilters)) {
                if (typeof (row as any)[field] !== "number" || (row as any)[field] > value) return false
              }
              return true
            })
          }
          return {
            take: async (limit: number) => filtered().slice(0, Math.max(0, Math.trunc(limit))),
            collect: async () => filtered(),
          }
        },
      }),
      patch: async (id: string, update: any) => {
        const key = String(id)
        if (jobs.has(key)) {
          jobs.set(key, { ...jobs.get(key), ...update })
          return
        }
        if (runs.has(key)) {
          runs.set(key, { ...runs.get(key), ...update })
          return
        }
        throw new Error(`patch target not found: ${key}`)
      },
    },
  }

  return { ctx, jobs, runs }
}

describe("sealed finalize + lease", () => {
  it("finalize transitions sealed_pending to queued and leases only targeted runner", async () => {
    vi.useFakeTimers()
    const now = 5_000_000
    vi.setSystemTime(now)
    const { ctx, jobs, runs } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "secrets_init", createdAt: now - 100 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "secrets_init",
          status: "sealed_pending",
          targetRunnerId: "r1",
          sealedInputRequired: true,
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid123",
          sealedPendingExpiresAt: now + 60_000,
          attempt: 0,
          createdAt: now - 50,
        },
      ],
    })

    const finalized = await __test_finalizeSealedEnqueueInternalHandler(ctx as any, {
      projectId: "p1" as any,
      jobId: "job1" as any,
      kind: "secrets_init",
      sealedInputB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid123",
    })
    expect(finalized).toEqual({ jobId: "job1", runId: "run1" })
    expect(jobs.get("job1")?.status).toBe("queued")
    expect(jobs.get("job1")?.sealedInputB64).toBe("ciphertext")
    expect(runs.get("run1")?.status).toBe("queued")

    const wrongRunner = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "r2" as any,
      leaseTtlMs: 30_000,
    })
    expect(wrongRunner).toBeNull()

    const rightRunner = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "r1" as any,
      leaseTtlMs: 30_000,
    })
    expect(rightRunner?.jobId).toBe("job1")
    expect(rightRunner?.targetRunnerId).toBe("r1")
    expect(jobs.get("job1")?.status).toBe("leased")
    expect(runs.get("run1")?.status).toBe("running")
    vi.useRealTimers()
  })

  it("rejects finalize when reservation expired", async () => {
    vi.useFakeTimers()
    const now = 6_000_000
    vi.setSystemTime(now)
    const { ctx } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "secrets_init", createdAt: now - 100 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "secrets_init",
          status: "sealed_pending",
          targetRunnerId: "r1",
          sealedInputRequired: true,
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid123",
          sealedPendingExpiresAt: now - 1,
          attempt: 0,
          createdAt: now - 50,
        },
      ],
    })

    await expect(
      __test_finalizeSealedEnqueueInternalHandler(ctx as any, {
        projectId: "p1" as any,
        jobId: "job1" as any,
        kind: "secrets_init",
        sealedInputB64: "ciphertext",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "kid123",
      }),
    ).rejects.toThrow(/reservation expired/i)
    vi.useRealTimers()
  })

  it("rejects finalize with wrong algorithm or key id", async () => {
    vi.useFakeTimers()
    const now = 7_000_000
    vi.setSystemTime(now)
    const { ctx } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "secrets_init", createdAt: now - 100 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "secrets_init",
          status: "sealed_pending",
          targetRunnerId: "r1",
          sealedInputRequired: true,
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputKeyId: "kid123",
          sealedPendingExpiresAt: now + 60_000,
          attempt: 0,
          createdAt: now - 50,
        },
      ],
    })

    await expect(
      __test_finalizeSealedEnqueueInternalHandler(ctx as any, {
        projectId: "p1" as any,
        jobId: "job1" as any,
        kind: "secrets_init",
        sealedInputB64: "ciphertext",
        sealedInputAlg: "rsa-oaep-2048/aes-256-gcm",
        sealedInputKeyId: "kid123",
      }),
    ).rejects.toThrow(/sealedInputAlg mismatch/i)

    await expect(
      __test_finalizeSealedEnqueueInternalHandler(ctx as any, {
        projectId: "p1" as any,
        jobId: "job1" as any,
        kind: "secrets_init",
        sealedInputB64: "ciphertext",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "other-kid",
      }),
    ).rejects.toThrow(/key changed/i)
    vi.useRealTimers()
  })

  it("lease cleanup fails expired sealed_pending reservations", async () => {
    vi.useFakeTimers()
    const now = 8_000_000
    vi.setSystemTime(now)
    const { ctx, jobs, runs } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "secrets_init", createdAt: now - 100 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "secrets_init",
          status: "sealed_pending",
          targetRunnerId: "r1",
          sealedInputRequired: true,
          sealedPendingExpiresAt: now - 1,
          attempt: 0,
          createdAt: now - 50,
        },
      ],
    })

    const out = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "r1" as any,
      leaseTtlMs: 30_000,
    })
    expect(out).toBeNull()
    expect(jobs.get("job1")?.status).toBe("failed")
    expect(jobs.get("job1")?.errorMessage).toContain("reservation expired")
    expect(runs.get("run1")?.status).toBe("failed")
    expect(runs.get("run1")?.errorMessage).toContain("reservation expired")
    vi.useRealTimers()
  })
})
