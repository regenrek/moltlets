import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveConnectionStepMissingRequirements, shouldShowConnectionSshKeyEditor } from "../src/lib/setup/connection-step"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

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

  it("suppresses missing admin CIDR while detection is in progress", () => {
    const missing = resolveConnectionStepMissingRequirements({
      host: "alpha",
      adminCidr: "",
      adminCidrDetecting: true,
      hasProjectSshKeys: true,
      keyText: "",
    })
    expect(missing).not.toContain("admin IP (CIDR)")
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

  it("renders only one admin CIDR label in connection step", () => {
    const source = readFile("components/setup/steps/step-connection.tsx")
    const cidrLabelCount = (source.match(/Allowed admin IP \(CIDR\)/g) ?? []).length
    expect(source).toContain("<AdminCidrField")
    expect(cidrLabelCount).toBe(1)
    expect(source).not.toContain("adminCidr.trim() || props.projectAdminCidr.trim() || \"Not set\"")
  })

  it("shows configured admin password as locked until removed", () => {
    const source = readFile("components/setup/steps/step-connection.tsx")
    expect(source).toContain("value=\"Saved for this host\"")
    expect(source).toContain("setAdminPasswordUnlocked(true)")
    expect(source).toContain("Already saved for this host. Click Remove to set a new password.")
    expect(source).not.toContain("If already set, you can leave this empty.")
  })
})
