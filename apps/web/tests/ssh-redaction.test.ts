import { describe, expect, it } from "vitest"
import { maskKnownHostEntry, maskSshPublicKey } from "../src/lib/ssh-redaction"

describe("ssh redaction helpers", () => {
  it("masks SSH public key payload and keeps minimal context", () => {
    const input = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePayloadExample123456 user@workstation"
    const masked = maskSshPublicKey(input)

    expect(masked).toContain("ssh-ed25519")
    expect(masked).toContain("fp:")
    expect(masked).toContain("…")
    expect(masked).not.toContain("AAAAC3NzaC1lZDI1NTE5AAAAIFakePayloadExample123456")
  })

  it("masks known_hosts payload and keeps host + algo context", () => {
    const input = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKnownHostPayloadExample987654"
    const masked = maskKnownHostEntry(input)

    expect(masked).toContain("github.com")
    expect(masked).toContain("ssh-ed25519")
    expect(masked).toContain("fp:")
    expect(masked).not.toContain("AAAAC3NzaC1lZDI1NTE5AAAAIKnownHostPayloadExample987654")
  })

  it("handles malformed known_hosts entries safely", () => {
    const masked = maskKnownHostEntry("just-one-token")
    expect(masked).toContain("known-host")
    expect(masked).toContain("fp:")
    expect(masked).not.toContain("just-one-token")
  })

  it("keeps marker + host-set context while masking key body", () => {
    const input = "@cert-authority host-a.example.com,host-b.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQD123456"
    const masked = maskKnownHostEntry(input)

    expect(masked).toContain("@cert-authority")
    expect(masked).toContain("host-a.example.com")
    expect(masked).toContain("+1")
    expect(masked).toContain("ssh-rsa")
    expect(masked).not.toContain("AAAAB3NzaC1yc2EAAAADAQABAAACAQD123456")
  })
})
