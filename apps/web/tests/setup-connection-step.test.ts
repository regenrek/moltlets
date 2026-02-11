import { describe, expect, it } from "vitest"
import { resolveConnectionStepMissingRequirements, shouldShowConnectionSshKeyEditor } from "../src/lib/setup/connection-step"

describe("connection step helpers", () => {
  it("does not require a pasted key when project SSH keys already exist", () => {
    const missing = resolveConnectionStepMissingRequirements({
      host: "alpha",
      adminCidr: "203.0.113.10/32",
      hasProjectSshKeys: true,
      keyText: "",
    })
    expect(missing).toEqual([])
  })

  it("requires SSH key when no project key exists and none is pasted", () => {
    const missing = resolveConnectionStepMissingRequirements({
      host: "alpha",
      adminCidr: "203.0.113.10/32",
      hasProjectSshKeys: false,
      keyText: "   ",
    })
    expect(missing).toContain("SSH public key")
  })

  it("hides SSH key editor by default when project keys exist", () => {
    const show = shouldShowConnectionSshKeyEditor({
      hasProjectSshKeys: true,
      showKeyEditor: false,
      keyText: "",
    })
    expect(show).toBe(false)
  })

  it("shows SSH key editor when user opts to add another key", () => {
    const show = shouldShowConnectionSshKeyEditor({
      hasProjectSshKeys: true,
      showKeyEditor: true,
      keyText: "",
    })
    expect(show).toBe(true)
  })
})
