import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup runner offline dedup", () => {
  it("suppresses per-section runner banners in infrastructure and tailscale steps", () => {
    const infra = readSource("components/setup/steps/step-infrastructure.tsx")
    const tailscale = readSource("components/setup/steps/step-tailscale-lockdown.tsx")

    expect(infra).not.toContain("RunnerStatusBanner")
    expect(infra).not.toContain("showRunnerStatusBanner")
    expect(infra).not.toContain("showRunnerStatusDetails")

    expect(tailscale).not.toContain("import { RunnerStatusBanner")
    expect(tailscale).not.toContain("<RunnerStatusBanner")
    expect(tailscale).toContain("showRunnerStatusBanner={false}")
    expect(tailscale).toContain("showRunnerStatusDetails={false}")
  })

  it("suppresses setup deploy section banner when top-level setup banner exists", () => {
    const stepDeploy = readSource("components/setup/steps/step-deploy.tsx")
    expect(stepDeploy).toContain("showRunnerStatusBanner={false}")

    const deploySetup = readSource("components/deploy/deploy-initial-setup.tsx")
    expect(deploySetup).toContain("{props.showRunnerStatusBanner !== false ? (")
  })
})
