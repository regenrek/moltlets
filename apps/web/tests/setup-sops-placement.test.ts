import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup sops placement", () => {
  it("keeps SOPS hidden from setup and GitHub token in dedicated creds step", () => {
    const connectionStep = readFile("components/setup/steps/step-connection.tsx")
    const infrastructureStep = readFile("components/setup/steps/step-infrastructure.tsx")
    const credsStep = readFile("components/setup/steps/step-creds.tsx")
    const setupModel = readFile("lib/setup/setup-model.ts")

    expect(connectionStep).not.toContain("SetupSopsAgeKeyField")
    expect(connectionStep).not.toContain("SOPS age key path")
    expect(infrastructureStep).not.toContain("visibleKeys={[\"GITHUB_TOKEN\"]}")
    expect(infrastructureStep).not.toContain("title=\"GitHub token\"")
    expect(credsStep).toContain("visibleKeys={[\"GITHUB_TOKEN\"]}")
    expect(credsStep).toContain("title=\"GitHub token\"")
    expect(setupModel).toContain('"creds"')
    expect(infrastructureStep).not.toContain("SOPS_AGE_KEY_FILE")
    expect(setupModel).not.toContain('"predeploy"')
  })
})
