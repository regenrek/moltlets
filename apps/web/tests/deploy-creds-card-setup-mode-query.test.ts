import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("deploy creds card setup-mode query behavior", () => {
  it("disables live deploy-creds status query in setup mode and uses component-scoped draft merge state", () => {
    const source = readFile("components/fleet/deploy-creds-card.tsx")
    expect(source).toContain("enabled: runnerOnline && !setupDraftFlow")
    expect(source).toContain("setupDraftSaveSealedSection")
    expect(source).toContain("const [setupDraftValues, setSetupDraftValues] = useState")
    expect(source).not.toContain("setupDraftDeployCredsSession")
    expect(source).toContain("const sessionValues = { ...setupDraftValues }")
    expect(source).toContain("setSetupDraftValues(updates)")

    const setupBranchStart = source.indexOf("if (setupDraftFlow) {")
    const setupBranchReturn = source.indexOf("return input", setupBranchStart)
    const reserveIdx = source.indexOf("const reserve = await updateDeployCreds")
    expect(setupBranchStart).toBeGreaterThan(-1)
    expect(setupBranchReturn).toBeGreaterThan(setupBranchStart)
    expect(setupBranchReturn).toBeLessThan(reserveIdx)
  })
})
