import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup hetzner keyring reuse", () => {
  it("reuses ProjectTokenKeyringCard in infrastructure instead of custom hetzner token form", () => {
    const infrastructure = readFile("components/setup/steps/step-infrastructure.tsx")
    const apiKeysRoute = readFile("routes/$projectSlug/security/api-keys.tsx")

    expect(apiKeysRoute).toContain("ProjectTokenKeyringCard")
    expect(infrastructure).toContain("ProjectTokenKeyringCard")
    expect(infrastructure).toContain("kind=\"hcloud\"")
    expect(infrastructure).toContain("statusSummary={{")
    expect(infrastructure).toContain("hasActive: props.hcloudKeyringSummary?.hasActive === true")
    expect(infrastructure).not.toContain("setup-hcloud-key-value")
    expect(infrastructure).not.toContain("setup-hcloud-key-label")
  })
})
