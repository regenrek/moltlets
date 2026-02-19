import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup project creds fallback", () => {
  it("gates setup on GitHub and auto-seals host-scoped SOPS path at deploy time", () => {
    const model = readFile("lib/setup/setup-model.ts")
    const setupModelHook = readFile("lib/setup/use-setup-model.ts")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(model).toContain("hasProjectGithubToken")
    expect(model).not.toContain("hasProjectSopsAgeKeyPath")
    expect(setupModelHook).toContain("hasProjectGithubToken")
    expect(setupModelHook).toContain("deployCredsSummary?.hasGithubToken")
    expect(setupModelHook).not.toContain("setupDraftDeployCredsSet")
    expect(setupModelHook).not.toContain("getDeployCredsStatus")
    expect(setupModelHook).not.toContain("generateSopsAgeKey")
    expect(deploySetup).toContain("effectiveDeployCredsReady")
    expect(deploySetup).toContain("generateSopsAgeKey")
    expect(deploySetup).toContain("section: \"hostBootstrapCreds\"")
    expect(deploySetup).toContain("SOPS_AGE_KEY_FILE")
    expect(deploySetup).toContain("host: props.host")
  })
})
