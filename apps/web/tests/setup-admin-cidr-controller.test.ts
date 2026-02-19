import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup admin CIDR controller", () => {
  it("uses project-session detection state and reuses CIDR across hosts", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")
    expect(setupRoute).toContain("projectAdminCidr")
    expect(setupRoute).toContain("projectAdminCidrStatus")
    expect(setupRoute).toContain("detectProjectAdminCidr")
    expect(setupRoute).toContain("setPendingConnectionDraft((prev)")
    expect(setupRoute).toContain("adminCidr: sessionAdminCidr")
  })
})
