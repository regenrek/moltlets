import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup git readiness single source", () => {
  it("keeps git push readiness in repository setup only", () => {
    const predeploy = readFile("components/setup/steps/step-predeploy.tsx")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(predeploy).toContain("Git push readiness")
    expect(predeploy).toContain("Revision to deploy")
    expect(predeploy).toContain("Upstream")

    expect(deploySetup).not.toContain("Git readiness")
    expect(deploySetup).not.toContain("Remote deploy (default branch)")
    expect(deploySetup).not.toContain("Revision to deploy")
    expect(deploySetup).not.toContain("Upstream")
  })
})
