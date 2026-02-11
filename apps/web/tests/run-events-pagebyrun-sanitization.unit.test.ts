import { describe, expect, it, vi } from "vitest"

function buildCtx(params: {
  runProjectId: string
  rows: any[]
}) {
  const paginate = vi.fn(async () => ({
    page: params.rows,
    isDone: true,
    continueCursor: null,
  }))
  const order = vi.fn(() => ({ paginate }))
  const withIndex = vi.fn(() => ({ order }))
  const query = vi.fn(() => ({ withIndex }))
  const get = vi.fn(async () => ({ projectId: params.runProjectId }))
  return {
    db: { get, query },
    __mocks: { get, query, withIndex, order, paginate },
  }
}

describe("runEvents.pageByRun sanitization", () => {
  it("sanitizes even when row.sanitized===true (no bypass)", async () => {
    vi.resetModules()
    vi.doMock("../convex/shared/auth", () => ({
      requireProjectAccessQuery: vi.fn(async () => {}),
      requireProjectAccessMutation: vi.fn(async () => ({ role: "admin", authed: { user: { _id: "u1" } } })),
      requireAdmin: vi.fn(() => {}),
    }))

    const { pageByRun } = await import("../convex/controlPlane/runEvents")
    const handler = (pageByRun as any)._handler
    expect(typeof handler).toBe("function")

    const ctx = buildCtx({
      runProjectId: "p1",
      rows: [
        {
          _id: "e1",
          _creationTime: 1,
          projectId: "p1",
          runId: "r1",
          ts: 1,
          level: "info",
          message: "Authorization: Bearer supersecret DISCORD_TOKEN=abc123",
          meta: { kind: "phase", phase: "command_start" },
          sanitized: true,
        },
      ],
    })

    const res = await handler(ctx as any, { runId: "r1", paginationOpts: { numItems: 10, cursor: null } })
    expect(res.page[0]?.message).toContain("Authorization: Bearer <redacted>")
    expect(res.page[0]?.message).toContain("DISCORD_TOKEN=<redacted>")
    expect(res.page[0]?.redacted).toBe(true)
    expect(res.page[0]?.sanitized).toBe(true)
  })

  it("keeps safe messages unchanged when row.sanitized===true", async () => {
    vi.resetModules()
    vi.doMock("../convex/shared/auth", () => ({
      requireProjectAccessQuery: vi.fn(async () => {}),
      requireProjectAccessMutation: vi.fn(async () => ({ role: "admin", authed: { user: { _id: "u1" } } })),
      requireAdmin: vi.fn(() => {}),
    }))

    const { pageByRun } = await import("../convex/controlPlane/runEvents")
    const handler = (pageByRun as any)._handler
    expect(typeof handler).toBe("function")

    const ctx = buildCtx({
      runProjectId: "p1",
      rows: [
        {
          _id: "e1",
          _creationTime: 1,
          projectId: "p1",
          runId: "r1",
          ts: 1,
          level: "info",
          message: "hello world",
          sanitized: true,
        },
      ],
    })

    const res = await handler(ctx as any, { runId: "r1", paginationOpts: { numItems: 10, cursor: null } })
    expect(res.page[0]?.message).toBe("hello world")
    expect(res.page[0]?.redacted).toBe(false)
    expect(res.page[0]?.sanitized).toBe(true)
  })
})
