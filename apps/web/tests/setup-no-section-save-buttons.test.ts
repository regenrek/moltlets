import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup section save buttons", () => {
  it("removes setup-level save CTAs for host settings, access settings, and passwords step", () => {
    const infra = readFile("components/setup/steps/step-infrastructure.tsx")
    const connection = readFile("components/setup/steps/step-connection.tsx")
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(infra).not.toContain("Save host settings")
    expect(connection).not.toContain("Save access settings")
    expect(setupRoute).not.toContain('id === "secrets"')
  })
})
