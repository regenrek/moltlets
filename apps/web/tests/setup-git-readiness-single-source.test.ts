import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup git readiness single source", () => {
  it("keeps git push readiness in github access only", () => {
    const infrastructure = readFile("components/setup/steps/step-infrastructure.tsx")
    const deployCredsCard = readFile("components/fleet/deploy-creds-card.tsx")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(infrastructure).toContain("githubReadiness={{")
    expect(deployCredsCard).toContain("Git push readiness")
    expect(deployCredsCard).toContain("Revision to deploy")
    expect(deployCredsCard).toContain("Upstream")

    expect(deploySetup).not.toContain("Git readiness")
    expect(deploySetup).not.toContain("Remote deploy (default branch)")
    expect(deploySetup).not.toContain("Revision to deploy")
    expect(deploySetup).not.toContain("Upstream")
  })
})
