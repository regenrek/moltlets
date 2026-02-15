import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup sops placement", () => {
  it("keeps SOPS hidden from setup and GitHub token in infrastructure", () => {
    const connectionStep = readFile("components/setup/steps/step-connection.tsx")
    const infrastructureStep = readFile("components/setup/steps/step-infrastructure.tsx")
    const setupModel = readFile("lib/setup/setup-model.ts")

    expect(connectionStep).not.toContain("SetupSopsAgeKeyField")
    expect(connectionStep).not.toContain("SOPS age key path")
    expect(infrastructureStep).toContain("updatedKeys: [\"GITHUB_TOKEN\"]")
    expect(infrastructureStep).toContain("GitHub token queued")
    expect(infrastructureStep).not.toContain("SOPS_AGE_KEY_FILE")
    expect(setupModel).not.toContain('"predeploy"')
  })
})
