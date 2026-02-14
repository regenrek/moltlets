import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup project creds fallback", () => {
  it("tracks GitHub and SOPS readiness separately and auto-seals host draft credentials on deploy", () => {
    const model = readFile("lib/setup/setup-model.ts")
    const setupModelHook = readFile("lib/setup/use-setup-model.ts")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(model).toContain("hasProjectGithubToken")
    expect(model).toContain("hasProjectSopsAgeKeyPath")
    expect(setupModelHook).toContain("hasProjectGithubToken")
    expect(setupModelHook).toContain("hasProjectSopsAgeKeyPath")
    expect(deploySetup).toContain("effectiveDeployCredsReady")
    expect(deploySetup).toContain("section: \"deployCreds\"")
    expect(deploySetup).toContain("projectSopsAgeKeyPath")
  })
})
