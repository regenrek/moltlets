import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup tailscale lockdown deploy flow", () => {
  it("auto-sets tailnet mode before bootstrap when lockdown is enabled", () => {
    const deploy = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(deploy).toContain("const canAutoLockdown = wantsTailscaleLockdown && hasProjectTailscaleAuthKey")
    expect(deploy).toContain("if (canAutoLockdown && !isTailnet)")
    expect(deploy).toContain("path: `hosts.${props.host}.tailnet.mode`")
    // Bootstrap keeps public SSH reachable (admin CIDR) until post-bootstrap hardening runs.
    expect(deploy).toContain("lockdownAfter: false")
  })

  it("sets tailnet mode before switching SSH exposure during finalize", () => {
    const deploy = readFile("components/deploy/deploy-initial-setup.tsx")

    const switchStepStart = deploy.indexOf('id: "switchSshExposure"')
    const switchStepEnd = deploy.indexOf('id: "lockdown"', switchStepStart)
    const switchStep = deploy.slice(
      switchStepStart,
      switchStepEnd > switchStepStart ? switchStepEnd : undefined,
    )

    expect(switchStep).toContain("path: `hosts.${props.host}.tailnet.mode`")
    expect(switchStep).toContain("path: `hosts.${props.host}.sshExposure.mode`")
    expect(switchStep.indexOf("tailnet.mode")).toBeLessThan(switchStep.indexOf("sshExposure.mode"))
  })
})
