import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup predeploy order", () => {
  it("keeps repository setup before provider token inputs and passes first-push guidance into github token card", () => {
    const source = readFile("components/setup/steps/step-predeploy.tsx")

    expect(source.indexOf("title=\"Repository setup\"")).toBeLessThan(source.indexOf("<DeployCredsCard"))
    expect(source).toContain("githubRepoHint=\"Create the repository first")
    expect(source).toContain("githubFirstPushGuidance={readiness.showFirstPushGuidance")
  })
})
