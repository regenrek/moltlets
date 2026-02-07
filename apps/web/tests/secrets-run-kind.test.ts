import { describe, expect, it } from "vitest"
import { getSecretsVerifyRunKind } from "../src/sdk/secrets/run-kind"

describe("getSecretsVerifyRunKind", () => {
  it("maps scopes to run kinds", () => {
    expect(getSecretsVerifyRunKind("all")).toBe("secrets_verify")
    expect(getSecretsVerifyRunKind("updates")).toBe("secrets_verify")
    expect(getSecretsVerifyRunKind("bootstrap")).toBe("secrets_verify_bootstrap")
    expect(getSecretsVerifyRunKind("openclaw")).toBe("secrets_verify_openclaw")
  })
})

