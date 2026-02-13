import { describe, expect, it } from "vitest"

import { __test_upsertManyImplHandler } from "../convex/controlPlane/projectConfigs"

function makeCtx(params?: { existing?: any[] }) {
  const rows = new Map<string, any>((params?.existing ?? []).map((row) => [String(row._id), { ...row }]))
  const inserts: any[] = []
  const patches: Array<{ id: string; patch: any }> = []

  const ctx = {
    db: {
      query: (_table: "projectConfigs") => ({
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
            collect: async () => {
              return [...rows.values()].filter((row) =>
                Object.entries(filters).every(([field, value]) => (row as any)[field] === value),
              )
            },
          }
        },
      }),
      insert: async (_table: "projectConfigs", doc: any) => {
        const _id = String(doc._id || `pc_${rows.size + 1}`)
        const next = { _id, ...doc }
        rows.set(_id, next)
        inserts.push(next)
        return _id
      },
      patch: async (id: string, patch: any) => {
        const key = String(id)
        const existing = rows.get(key)
        if (!existing) throw new Error(`missing row: ${key}`)
        rows.set(key, { ...existing, ...patch })
        patches.push({ id: key, patch })
      },
    },
  }

  return { ctx, rows, inserts, patches }
}

describe("project config error redaction", () => {
  it("redacts secret-like tokens before persisting lastError", async () => {
    const { ctx, rows, inserts } = makeCtx()
    await __test_upsertManyImplHandler(ctx as any, {
      projectId: "p1" as any,
      entries: [
        {
          path: "fleet/clawlets.json",
          type: "fleet",
          error: "Authorization: Bearer secret123 https://user:pw@example.com?token=abc",
        },
      ],
    })
    expect(inserts).toHaveLength(1)
    const stored = rows.get(String(inserts[0]?._id))
    expect(stored.lastError).toContain("Authorization: Bearer <redacted>")
    expect(stored.lastError).toContain("https://<redacted>@example.com?token=<redacted>")
    expect(stored.lastError).not.toContain("secret123")
  })
})

