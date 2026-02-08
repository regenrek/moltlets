import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { parseLiveSchemaTarget } from "../convex/controlPlane/projects"

function expectConvexFail(fn: () => void, code: string, message?: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
    if (message) expect((err as any).data?.message).toBe(message)
  }
}

describe("guardLiveSchemaFetch validation", () => {
  it("rejects oversized host", () => {
    expectConvexFail(
      () => parseLiveSchemaTarget({ host: "a".repeat(129), gatewayId: "bot1" }),
      "conflict",
      "host too long",
    )
  })

  it("rejects oversized gatewayId", () => {
    expectConvexFail(
      () => parseLiveSchemaTarget({ host: "host1", gatewayId: "b".repeat(129) }),
      "conflict",
      "gatewayId too long",
    )
  })

  it("accepts valid host/gatewayId", () => {
    expect(parseLiveSchemaTarget({ host: "host-1", gatewayId: "bot_1" })).toEqual({
      host: "host-1",
      gatewayId: "bot_1",
    })
  })
})
