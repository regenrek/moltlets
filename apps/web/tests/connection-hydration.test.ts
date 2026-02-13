import { describe, expect, it } from "vitest"
import { deriveConnectionLateHydration } from "../src/lib/setup/connection-hydration"

describe("setup connection late hydration", () => {
  it("does nothing before config is loaded", () => {
    const result = deriveConnectionLateHydration({
      configLoaded: false,
      draftAdminCidr: "",
      draftSshAuthorizedKeys: [],
      hostAdminCidr: "1.2.3.4/32",
      fleetSshKeys: ["ssh-ed25519 AAAA user@host"],
      currentAdminCidr: "",
      currentKnownKeys: [],
      currentSelectedKeys: [],
    })
    expect(result).toBeNull()
  })

  it("hydrates admin CIDR and ssh keys when config appears and form is untouched", () => {
    const result = deriveConnectionLateHydration({
      configLoaded: true,
      draftAdminCidr: "",
      draftSshAuthorizedKeys: [],
      hostAdminCidr: "1.2.3.4/32",
      fleetSshKeys: ["ssh-ed25519 AAAA user@host"],
      currentAdminCidr: "",
      currentKnownKeys: [],
      currentSelectedKeys: [],
    })
    expect(result).toEqual({
      adminCidr: "1.2.3.4/32",
      knownKeys: ["ssh-ed25519 AAAA user@host"],
      selectedKeys: ["ssh-ed25519 AAAA user@host"],
    })
  })

  it("does not override user edits or draft values", () => {
    const result = deriveConnectionLateHydration({
      configLoaded: true,
      draftAdminCidr: "9.9.9.9/32",
      draftSshAuthorizedKeys: ["ssh-ed25519 BBBB draft@host"],
      hostAdminCidr: "1.2.3.4/32",
      fleetSshKeys: ["ssh-ed25519 AAAA user@host"],
      currentAdminCidr: "8.8.8.8/32",
      currentKnownKeys: ["ssh-ed25519 CCCC local@host"],
      currentSelectedKeys: ["ssh-ed25519 CCCC local@host"],
    })
    expect(result).toBeNull()
  })
})

