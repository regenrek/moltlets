import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { assertNoSecretLikeKeys } from "../convex/shared/controlPlane"
import { resolveRunKind } from "../convex/controlPlane/jobState"
import { hashToken } from "../convex/controlPlane/runnerTokens"

function expectConvexFail(fn: () => void, code: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
  }
}

describe("control-plane metadata guards", () => {
  it("rejects secret-like keys in payload meta", () => {
    expectConvexFail(
      () => assertNoSecretLikeKeys({ hostName: "alpha", value: "secret" }, "payloadMeta"),
      "conflict",
    )
    expectConvexFail(
      () => assertNoSecretLikeKeys({ nested: { token: "secret" } }, "payloadMeta"),
      "conflict",
    )
    expectConvexFail(
      () => assertNoSecretLikeKeys({ nested: [{ key: "secret" }] }, "payloadMeta"),
      "conflict",
    )
  })

  it("maps unknown job kind to custom run kind", () => {
    expect(resolveRunKind("secrets.write")).toBe("custom")
    expect(resolveRunKind("bootstrap")).toBe("bootstrap")
    expect(resolveRunKind("git_push")).toBe("git_push")
  })

  it("hashes runner tokens", async () => {
    const hash = await hashToken("abc")
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})
