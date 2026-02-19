import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup flow removes verify step", () => {
  it("keeps setup step order focused on install + lockdown", () => {
    const setupModel = readFile("lib/setup/setup-model.ts")
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(setupModel).not.toContain('"verify"')
    expect(setupRoute).not.toContain("SetupStepVerify")
    expect(setupRoute).not.toContain('"Secure and Verify"')
    expect(setupRoute).not.toContain("Continue to verify")
  })
})
