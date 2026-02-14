import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup sops placement", () => {
  it("moves SOPS key path to server access and keeps pre-deploy GitHub-only", () => {
    const connectionStep = readFile("components/setup/steps/step-connection.tsx")
    const predeployStep = readFile("components/setup/steps/step-predeploy.tsx")
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(connectionStep).toContain("SetupSopsAgeKeyField")
    expect(predeployStep).toContain("visibleKeys={[\"GITHUB_TOKEN\"]}")
    expect(predeployStep).not.toContain("visibleKeys={[\"GITHUB_TOKEN\", \"SOPS_AGE_KEY_FILE\"]}")
    expect(predeployStep).toContain("title=\"GitHub access\"")
    expect(setupRoute).toContain("GitHub token and first push")
  })
})
