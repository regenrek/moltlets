import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup deploy gating uses canonical desired-state resolver", () => {
  it("removes legacy fleet-only SSH gate and setup-mode deploy-creds runner query", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")
    expect(source).toContain("deriveEffectiveSetupDesiredState")
    expect(source).toContain("desired.connection.sshAuthorizedKeys")
    expect(source).not.toContain("deriveDeploySshKeyReadiness")
    expect(source).not.toContain("getDeployCredsStatus")
  })
})
