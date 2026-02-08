import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { assertNoSecretLikeKeys } from "../convex/lib/controlPlane"
import { __test_resolveRunKind } from "../convex/jobs"
import { __test_hashToken } from "../convex/runnerTokens"

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
    expect(__test_resolveRunKind("secrets.write")).toBe("custom")
    expect(__test_resolveRunKind("bootstrap")).toBe("bootstrap")
    expect(__test_resolveRunKind("git_push")).toBe("git_push")
  })

  it("hashes runner tokens", async () => {
    const hash = await __test_hashToken("abc")
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})
