import { describe, expect, it, vi } from "vitest"
import { __test_takeCommandResultBlobUrlInternalHandler } from "../convex/controlPlane/jobs"

function makeCtx(params: {
  now: number
  jobs: Array<Record<string, any>>
  blobs: Array<Record<string, any>>
}) {
  const jobs = new Map<string, Record<string, any>>(params.jobs.map((row) => [String(row._id), { ...row }]))
  const blobs = new Map<string, Record<string, any>>(params.blobs.map((row) => [String(row._id), { ...row }]))

  const storage = {
    getUrl: vi.fn(async (storageId: string) => `https://storage.local/${storageId}`),
    delete: vi.fn(async (storageId: string) => storageId),
  }

  const ctx = {
    db: {
      get: async (id: string) => {
        const key = String(id)
        if (jobs.has(key)) return jobs.get(key)
        if (blobs.has(key)) return blobs.get(key)
        return null
      },
      query: (table: "runnerCommandResultBlobs") => ({
        withIndex: (_name: string, fn: (q: any) => any) => {
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
            const source = table === "runnerCommandResultBlobs" ? [...blobs.values()] : []
            return source.filter((row) => {
              for (const [field, value] of Object.entries(eqFilters)) {
                if (row[field] !== value) return false
              }
              for (const [field, value] of Object.entries(lteFilters)) {
                if (typeof row[field] !== "number" || row[field] > value) return false
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
      patch: async (id: string, update: Record<string, unknown>) => {
        const key = String(id)
        if (blobs.has(key)) {
          blobs.set(key, { ...blobs.get(key), ...update })
          return
        }
        if (jobs.has(key)) {
          jobs.set(key, { ...jobs.get(key), ...update })
          return
        }
        throw new Error(`patch target not found: ${key}`)
      },
      delete: async (id: string) => {
        blobs.delete(String(id))
      },
    },
    storage,
  }

  return { ctx, blobs, storage, now: params.now }
}

describe("takeCommandResultBlobUrl read-once semantics", () => {
  it("consumes newest blob exactly once and leaves consumed row for TTL purge", async () => {
    const now = 1_000_000
    const { ctx, blobs, storage } = makeCtx({
      now,
      jobs: [{ _id: "job1", projectId: "p1", runId: "run1" }],
      blobs: [
        {
          _id: "blob-old",
          projectId: "p1",
          runId: "run1",
          jobId: "job1",
          storageId: "s-old",
          sizeBytes: 12,
          createdAt: now - 200,
          expiresAt: now + 60_000,
        },
        {
          _id: "blob-new",
          projectId: "p1",
          runId: "run1",
          jobId: "job1",
          storageId: "s-new",
          sizeBytes: 24,
          createdAt: now - 100,
          expiresAt: now + 60_000,
        },
      ],
    })

    const first = await __test_takeCommandResultBlobUrlInternalHandler(ctx as any, {
      projectId: "p1" as any,
      jobId: "job1" as any,
      now,
    })
    expect(first).toMatchObject({
      runId: "run1",
      sizeBytes: 24,
      url: "https://storage.local/s-new",
    })
    expect(storage.getUrl).toHaveBeenCalledTimes(1)
    expect(storage.delete).toHaveBeenCalledWith("s-old")
    expect(blobs.has("blob-old")).toBe(false)
    expect(blobs.get("blob-new")?.consumedAt).toBe(now)

    const second = await __test_takeCommandResultBlobUrlInternalHandler(ctx as any, {
      projectId: "p1" as any,
      jobId: "job1" as any,
      now: now + 1,
    })
    expect(second).toBeNull()
    expect(storage.getUrl).toHaveBeenCalledTimes(1)
    expect(storage.delete).toHaveBeenCalledTimes(1)
    expect(blobs.get("blob-new")?.storageId).toBe("s-new")
  })
})
