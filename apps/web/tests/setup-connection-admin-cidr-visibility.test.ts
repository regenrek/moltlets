import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup connection admin cidr visibility", () => {
  it("moves Admin CIDR editing into advanced options", () => {
    const source = readFile("components/setup/steps/step-connection.tsx")

    const adminFieldIndex = source.indexOf("<AdminCidrField")
    const accordionIndex = source.indexOf("<Accordion className=\"rounded-lg border bg-muted/20\"")

    expect(adminFieldIndex).toBeGreaterThan(-1)
    expect(accordionIndex).toBeGreaterThan(-1)
    expect(adminFieldIndex).toBeGreaterThan(accordionIndex)
    expect(source).toContain("Admin CIDR is auto-detected during setup entry.")
  })
})
