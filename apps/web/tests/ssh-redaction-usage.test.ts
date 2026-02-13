import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("ssh redaction usage", () => {
  it("uses masked key display in setup connection step", () => {
    const source = readSource("components/setup/steps/step-connection.tsx")
    expect(source).toContain("maskSshPublicKey")
    expect(source).toContain("{maskSshPublicKey(key)}")
    expect(source).not.toContain("{key}</code>")
  })

  it("uses masked display in security ssh settings lists", () => {
    const source = readSource("routes/$projectSlug/security/ssh-keys.tsx")
    expect(source).toContain("maskSshPublicKey")
    expect(source).toContain("maskKnownHostEntry")
    expect(source).toContain("{maskSshPublicKey(k)}")
    expect(source).toContain("{maskKnownHostEntry(entry)}")
  })
})
