import { describe, expect, it } from "vitest"
import { deriveDeploySshKeyReadiness } from "../src/lib/setup/deploy-ssh-key-readiness"

describe("deriveDeploySshKeyReadiness", () => {
  it("is ready when fleet ssh key exists", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: ["ssh-ed25519 AAAATEST"],
      hostProvisioningSshPubkeyFile: "",
    })).toEqual({ ready: true, source: "fleet" })
  })

  it("is ready when host provisioning path exists and fleet is empty", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: [],
      hostProvisioningSshPubkeyFile: "/tmp/id_ed25519.pub",
    })).toEqual({ ready: true, source: "hostPath" })
  })

  it("is missing when no fleet key and no host path", () => {
    expect(deriveDeploySshKeyReadiness({
      fleetSshAuthorizedKeys: [],
      hostProvisioningSshPubkeyFile: "  ",
    })).toEqual({ ready: false, source: "missing" })
  })
})
