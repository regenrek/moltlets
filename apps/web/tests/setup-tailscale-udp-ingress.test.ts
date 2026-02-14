import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup tailscale UDP ingress", () => {
  it("keeps the UDP ingress control in tailscale lockdown, not infrastructure", () => {
    const infra = readFile("components/setup/steps/step-infrastructure.tsx")
    const tailscale = readFile("components/setup/steps/step-tailscale-lockdown.tsx")

    expect(infra).not.toContain("Allow Tailscale UDP ingress")
    expect(tailscale).toContain("Allow Tailscale UDP ingress")
    expect(tailscale).toContain("onAllowTailscaleUdpIngressChange")
    expect(tailscale).toContain("Advanced options")
    expect(tailscale.indexOf("Tailscale API keys")).toBeLessThan(tailscale.indexOf("Allow Tailscale UDP ingress"))
  })

  it("auto-enables UDP ingress when tailscale lockdown is turned on", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(setupRoute).toContain("onUseTailscaleLockdownChange={(value) => {")
    expect(setupRoute).toContain("allowTailscaleUdpIngress: true")
  })

  it("merges infrastructure draft updates so cross-step edits do not clobber each other", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(setupRoute).toContain("setPendingInfrastructureDraft((prev) => ({")
    expect(setupRoute).toContain("...(prev ?? {}),")
    expect(setupRoute).toContain("...next,")
  })
})
