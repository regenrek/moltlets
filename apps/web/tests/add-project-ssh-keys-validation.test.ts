import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("project ssh keys validation hardening", () => {
  it("rejects non-empty inputs that parse to zero keys/known_hosts entries", () => {
    const source = readFile("sdk/config/hosts.ts")
    expect(source).toContain("no valid SSH public keys parsed from input")
    expect(source).toContain("no valid known_hosts entries parsed from input")
  })

  it("surfaces add-SSH server errors in the UI toast", () => {
    const source = readFile("routes/$projectSlug/security/ssh-keys.tsx")
    expect(source).toContain("onError: (error)")
    expect(source).toContain("toast.error(error instanceof Error ? error.message : String(error))")
  })
})
