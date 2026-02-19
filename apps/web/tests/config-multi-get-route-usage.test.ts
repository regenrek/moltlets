import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8")
}

describe("config multi-get route usage", () => {
  it("keeps setup fleet reads collapsed into one multi-get", () => {
    const source = readSource("src/routes/$projectSlug/setup/fleet.tsx")
    expect(source).toContain("configDotMultiGet")
    expect(source).toContain('paths: ["schemaVersion", "defaultHost", "baseFlake", "fleet", "hosts"]')
  })

  it("reads ssh keys from projectCredentials instead of config multi-get", () => {
    const source = readSource("src/routes/$projectSlug/security/ssh-keys.tsx")
    expect(source).toContain("api.controlPlane.projectCredentials.listByProject")
    expect(source).toContain('bySection.get("sshAuthorizedKeys")?.metadata?.stringItems')
    expect(source).toContain('bySection.get("sshKnownHosts")?.metadata?.stringItems')
    expect(source).not.toContain("configDotMultiGet")
  })

  it("keeps gateway settings reads collapsed into one multi-get", () => {
    const source = readSource("src/routes/$projectSlug/hosts/$host/gateways/$gatewayId/settings.tsx")
    expect(source).toContain("configDotMultiGet")
    expect(source).toContain('paths: [`hosts.${host}.gateways.${gatewayId}`, "fleet.secretEnv"]')
  })
})
