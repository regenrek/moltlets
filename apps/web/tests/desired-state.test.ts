import { describe, expect, it } from "vitest"
import { deriveEffectiveSetupDesiredState } from "../src/lib/setup/desired-state"

describe("deriveEffectiveSetupDesiredState", () => {
  it("applies precedence pending > draft > config", () => {
    const desired = deriveEffectiveSetupDesiredState({
      config: {
        hosts: {
          h1: {
            provisioning: { adminCidr: "203.0.113.1/32" },
            sshExposure: { mode: "public" },
            hetzner: {
              serverType: "cx11",
              image: "nixos",
              location: "fsn1",
              allowTailscaleUdpIngress: false,
            },
          },
        },
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAA config"] },
      },
      host: "h1",
      setupDraft: {
        nonSecretDraft: {
          infrastructure: {
            serverType: "cx22",
            image: "draft-image",
            location: "nbg1",
            allowTailscaleUdpIngress: true,
          },
          connection: {
            adminCidr: "203.0.113.2/32",
            sshExposureMode: "tailnet",
            sshAuthorizedKeys: ["ssh-ed25519 AAAA draft"],
            sshKeyCount: 1,
          },
        },
      },
      pendingNonSecretDraft: {
        infrastructure: {
          serverType: "cpx31",
          location: "hel1",
        },
        connection: {
          adminCidr: "203.0.113.3/32",
          sshExposureMode: "bootstrap",
          sshAuthorizedKeys: ["ssh-ed25519 AAAA pending"],
          sshKeyCount: 2,
        },
      },
    })

    expect(desired.infrastructure.serverType).toBe("cpx31")
    expect(desired.infrastructure.location).toBe("hel1")
    expect(desired.infrastructure.image).toBe("draft-image")
    expect(desired.infrastructure.allowTailscaleUdpIngress).toBe(true)
    expect(desired.infrastructure.source.serverType).toBe("pending")
    expect(desired.infrastructure.source.image).toBe("draft")
    expect(desired.infrastructure.source.allowTailscaleUdpIngress).toBe("draft")

    expect(desired.connection.adminCidr).toBe("203.0.113.3/32")
    expect(desired.connection.sshExposureMode).toBe("bootstrap")
    expect(desired.connection.sshAuthorizedKeys).toEqual(["ssh-ed25519 AAAA pending"])
    expect(desired.connection.sshKeyCount).toBe(1)
    expect(desired.connection.source.adminCidr).toBe("pending")
    expect(desired.connection.source.sshExposureMode).toBe("pending")
    expect(desired.connection.source.sshAuthorizedKeys).toBe("pending")
  })

  it("normalizes SSH keys by trimming and de-duping with stable first occurrence order", () => {
    const desired = deriveEffectiveSetupDesiredState({
      config: {
        hosts: { h1: {} },
        fleet: {
          sshAuthorizedKeys: [
            "  ssh-ed25519 AAAA one  ",
            "ssh-ed25519 AAAA two",
            "ssh-ed25519 AAAA one",
          ],
        },
      },
      host: "h1",
      setupDraft: null,
      pendingNonSecretDraft: null,
    })

    expect(desired.connection.sshAuthorizedKeys).toEqual([
      "ssh-ed25519 AAAA one",
      "ssh-ed25519 AAAA two",
    ])
    expect(desired.connection.sshKeyCount).toBe(2)
    expect(desired.connection.source.sshAuthorizedKeys).toBe("config")
  })

  it("coerces invalid ssh exposure mode to bootstrap default", () => {
    const desired = deriveEffectiveSetupDesiredState({
      config: {
        hosts: {
          h1: {
            sshExposure: { mode: "nope" },
          },
        },
        fleet: { sshAuthorizedKeys: [] },
      },
      host: "h1",
      setupDraft: null,
      pendingNonSecretDraft: null,
    })

    expect(desired.connection.sshExposureMode).toBe("bootstrap")
    expect(desired.connection.source.sshExposureMode).toBe("missing")
  })

  it("keeps draft SSH keys when config fleet keys are empty (#222 regression)", () => {
    const desired = deriveEffectiveSetupDesiredState({
      config: {
        hosts: { h1: {} },
        fleet: { sshAuthorizedKeys: [] },
      },
      host: "h1",
      setupDraft: {
        nonSecretDraft: {
          connection: {
            sshAuthorizedKeys: ["ssh-ed25519 AAAA draft-only"],
            sshKeyCount: 1,
          },
        },
      },
      pendingNonSecretDraft: null,
    })

    expect(desired.connection.sshAuthorizedKeys).toEqual(["ssh-ed25519 AAAA draft-only"])
    expect(desired.connection.sshKeyCount).toBe(1)
    expect(desired.connection.source.sshAuthorizedKeys).toBe("draft")
  })

  it("keeps ssh key count aligned to the resolved key list when draft counts are stale", () => {
    const desired = deriveEffectiveSetupDesiredState({
      config: {
        hosts: { h1: {} },
        fleet: { sshAuthorizedKeys: [] },
      },
      host: "h1",
      setupDraft: {
        nonSecretDraft: {
          connection: {
            sshAuthorizedKeys: [],
            sshKeyCount: 7,
          },
        },
      },
      pendingNonSecretDraft: {
        connection: {
          sshAuthorizedKeys: [],
          sshKeyCount: 9,
        },
      },
    })

    expect(desired.connection.sshAuthorizedKeys).toEqual([])
    expect(desired.connection.sshKeyCount).toBe(0)
  })
})
