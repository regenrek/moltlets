import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup verify links", () => {
  it("routes primary verify CTA to VPN settings instead of self-linking verify", () => {
    const verifyStep = readFile("components/setup/steps/step-verify.tsx")

    expect(verifyStep).toContain('to="/$projectSlug/hosts/$host/settings/vpn"')
    expect(verifyStep).toContain("Open VPN settings")
    expect(verifyStep).not.toContain('search={{ step: "verify" }}')
  })
})
