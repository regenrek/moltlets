import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("deploy creds card setup-mode query behavior", () => {
  it("keeps live deploy-creds status enabled in setup mode", () => {
    const source = readFile("components/fleet/deploy-creds-card.tsx")
    expect(source).toContain("enabled: runnerOnline")
    expect(source).toContain("setupDraftSaveSealedSection")
  })
})
