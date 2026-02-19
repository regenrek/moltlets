import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("deploy creds card setup-mode query behavior", () => {
  it("uses runner metadata for status reads and keeps setup-draft writes local to sealed draft state", () => {
    const source = readFile("components/fleet/deploy-creds-card.tsx")
    expect(source).not.toContain("getDeployCredsStatus")
    expect(source).toContain("const effectiveStatusSummary = useMemo<DeployCredKeyStatusSummary>(")
    expect(source).toContain("const runnerSummary = selectedRunner?.deployCredsSummary")
    expect(source).toContain("setupDraftSaveSealedSection")
    expect(source).toContain("const [setupDraftValues, setSetupDraftValues] = useState")
    expect(source).toContain("const sessionValues = { ...setupDraftValues }")
    expect(source).toContain("setSetupDraftValues(updates)")

    const setupBranchStart = source.indexOf("if (setupDraftFlow) {")
    const setupBranchReturn = source.indexOf("return input", setupBranchStart)
    const queueIdx = source.indexOf("await queueDeployCredsUpdate")
    expect(setupBranchStart).toBeGreaterThan(-1)
    expect(setupBranchReturn).toBeGreaterThan(setupBranchStart)
    expect(setupBranchReturn).toBeLessThan(queueIdx)
  })
})
