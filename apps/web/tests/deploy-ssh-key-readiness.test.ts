import { describe, expect, it } from "vitest"
import { deriveDeploySshKeyReadiness } from "../src/lib/setup/deploy-ssh-key-readiness"

describe("deriveDeploySshKeyReadiness", () => {
  it("is ready when fleet ssh key exists", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: ["ssh-ed25519 AAAATEST"],
    })).toEqual({ ready: true, source: "fleet" })
  })

  it("is missing when only host provisioning path exists and fleet is empty", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: [],
    })).toEqual({ ready: false, source: "missing" })
  })

  it("is missing when no fleet key and no host path", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: [],
    })).toEqual({ ready: false, source: "missing" })
  })
})
