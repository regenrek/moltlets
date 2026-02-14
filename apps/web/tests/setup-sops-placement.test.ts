import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup sops placement", () => {
  it("keeps SOPS key path in server access and GitHub token in infrastructure", () => {
    const connectionStep = readFile("components/setup/steps/step-connection.tsx")
    const infrastructureStep = readFile("components/setup/steps/step-infrastructure.tsx")
    const setupModel = readFile("lib/setup/setup-model.ts")

    expect(connectionStep).toContain("SetupSopsAgeKeyField")
    expect(connectionStep.indexOf("SetupSopsAgeKeyField")).toBeLessThan(connectionStep.indexOf("Advanced options"))
    expect(infrastructureStep).toContain("visibleKeys={[\"GITHUB_TOKEN\"]}")
    expect(infrastructureStep).not.toContain("visibleKeys={[\"GITHUB_TOKEN\", \"SOPS_AGE_KEY_FILE\"]}")
    expect(infrastructureStep).toContain("title=\"GitHub access\"")
    expect(setupModel).not.toContain('"predeploy"')
  })
})
