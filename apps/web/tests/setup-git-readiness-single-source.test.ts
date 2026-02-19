import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup git readiness single source", () => {
  it("shows git push readiness in setup creds step using deploy creds card primitives", () => {
    const creds = readFile("components/setup/steps/step-creds.tsx")
    const infrastructure = readFile("components/setup/steps/step-infrastructure.tsx")
    const deployCredsCard = readFile("components/fleet/deploy-creds-card.tsx")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(creds).toContain("deriveDeployReadiness")
    expect(creds).toContain("githubReadiness={githubReadiness}")
    expect(creds).toContain("githubFirstPushGuidance={githubFirstPushGuidance}")
    expect(creds).toContain("api.controlPlane.jobs.listByProject")
    expect(creds).toContain("enabled: false")
    expect(creds).toContain("setRepoStatusChecked(true)")
    expect(creds).toContain("statusSummary={{")
    expect(creds).toContain("GITHUB_TOKEN: { status:")
    expect(creds).toContain("deriveFirstPushGuidance")
    expect(infrastructure).not.toContain("githubFirstPushGuidance={githubFirstPushGuidance}")
    expect(infrastructure).not.toContain('title="GitHub token"')
    expect(deployCredsCard).toContain("statusSummary?: DeployCredKeyStatusSummary | null")
    expect(deployCredsCard).toContain("const effectiveStatusSummary = useMemo<DeployCredKeyStatusSummary>(")
    expect(deployCredsCard).toContain("Git push readiness")
    expect(deployCredsCard).toContain("Revision to deploy")
    expect(deployCredsCard).toContain("Upstream")

    expect(deploySetup).not.toContain("Git readiness")
    expect(deploySetup).not.toContain("Remote deploy (default branch)")
    expect(deploySetup).not.toContain("Revision to deploy")
    expect(deploySetup).not.toContain("Upstream")
  })
})
