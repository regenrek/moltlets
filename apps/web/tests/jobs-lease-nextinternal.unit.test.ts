import { describe, expect, it, vi } from "vitest"

import { __test_leaseNextInternalHandler } from "../convex/controlPlane/jobs"

function makeCtx(params: { jobs: any[]; runs: any[] }) {
  const jobs = new Map<string, any>(params.jobs.map((row) => [String(row._id), { ...row }]))
  const runs = new Map<string, any>(params.runs.map((row) => [String(row._id), { ...row }]))
  const patches: Array<{ id: string; update: any }> = []

  const ctx = {
    db: {
      query: (table: "jobs" | "runs") => ({
        withIndex: (_name: string, fn: any) => {
          const filters: Record<string, any> = {}
          const q: any = {
            eq: (field: string, value: any) => {
              filters[field] = value
              return q
            },
          }
          fn(q)
          return {
            take: async (limit: number) => {
              const rows = [...(table === "jobs" ? jobs.values() : runs.values())].filter((row) =>
                Object.entries(filters).every(([field, value]) => (row as any)[field] === value),
              )
              return rows.slice(0, Math.max(0, Math.trunc(limit)))
            },
          }
        },
      }),
      patch: async (id: string, update: any) => {
        patches.push({ id, update })
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

  return { ctx, patches, jobs, runs }
}

describe("jobs leaseNextInternal", () => {
  it("does not lease sealed_pending jobs", async () => {
    vi.useFakeTimers()
    const now = 1_000_000
    vi.setSystemTime(now)
    const { ctx, patches } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "custom", createdAt: now - 100 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "custom",
          status: "sealed_pending",
          targetRunnerId: "r1",
          sealedInputRequired: true,
          sealedPendingExpiresAt: now + 60_000,
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
    expect(patches).toHaveLength(0)
  })

  it("enforces targetRunnerId when leasing", async () => {
    vi.useFakeTimers()
    const now = 2_000_000
    vi.setSystemTime(now)
    const { ctx, patches, jobs, runs } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "queued", kind: "custom", createdAt: now - 200 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "custom",
          status: "queued",
          targetRunnerId: "rA",
          attempt: 0,
          createdAt: now - 100,
        },
      ],
    })

    const outWrongRunner = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "rB" as any,
      leaseTtlMs: 30_000,
    })
    expect(outWrongRunner).toBeNull()
    expect(patches).toHaveLength(0)

    const outRightRunner = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "rA" as any,
      leaseTtlMs: 30_000,
    })
    expect(outRightRunner?.jobId).toBe("job1")
    expect(outRightRunner?.targetRunnerId).toBe("rA")
    expect(outRightRunner?.attempt).toBe(1)

    expect(patches).toHaveLength(2)
    expect(patches[0]?.id).toBe("job1")
    expect(patches[0]?.update).toMatchObject({
      status: "leased",
      leasedByRunnerId: "rA",
    })
    expect(patches[1]?.id).toBe("run1")
    expect(patches[1]?.update).toMatchObject({
      status: "running",
      startedAt: now,
    })

    expect(jobs.get("job1")?.status).toBe("leased")
    expect(runs.get("run1")?.status).toBe("running")
  })

  it("requeues expired leased job and re-leases with incremented attempt", async () => {
    vi.useFakeTimers()
    const now = 3_000_000
    vi.setSystemTime(now)
    const { ctx, patches, jobs, runs } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "running", kind: "custom", createdAt: now - 500 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "custom",
          status: "leased",
          targetRunnerId: "r1",
          leaseId: "expired-lease",
          leasedByRunnerId: "r1",
          leaseExpiresAt: now - 20_001,
          attempt: 1,
          createdAt: now - 400,
        },
      ],
    })

    const out = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "r1" as any,
      leaseTtlMs: 30_000,
    })

    expect(out?.jobId).toBe("job1")
    expect(out?.targetRunnerId).toBe("r1")
    expect(out?.attempt).toBe(2)
    expect(jobs.get("job1")?.status).toBe("leased")
    expect(jobs.get("job1")?.attempt).toBe(2)
    expect(runs.get("run1")?.status).toBe("running")

    expect(patches[0]?.id).toBe("job1")
    expect(patches[0]?.update).toMatchObject({
      status: "queued",
      leaseId: undefined,
      leasedByRunnerId: undefined,
      leaseExpiresAt: undefined,
    })
    vi.useRealTimers()
  })

  it("does not requeue recently expired leased job within grace window", async () => {
    vi.useFakeTimers()
    const now = 3_100_000
    vi.setSystemTime(now)
    const { ctx, patches } = makeCtx({
      runs: [{ _id: "run1", projectId: "p1", status: "running", kind: "custom", createdAt: now - 500 }],
      jobs: [
        {
          _id: "job1",
          projectId: "p1",
          runId: "run1",
          kind: "custom",
          status: "leased",
          targetRunnerId: "r1",
          leaseId: "lease-a",
          leasedByRunnerId: "r1",
          leaseExpiresAt: now - 1,
          attempt: 1,
          createdAt: now - 400,
        },
      ],
    })

    const out = await __test_leaseNextInternalHandler(ctx as any, {
      projectId: "p1" as any,
      runnerId: "r1" as any,
      leaseTtlMs: 30_000,
    })

    expect(out).toBeNull()
    expect(patches).toHaveLength(0)
    vi.useRealTimers()
  })
})
