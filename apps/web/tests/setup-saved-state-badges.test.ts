import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup saved state badges", () => {
  it("shows per-section saved state badges in setup steps", () => {
    const infrastructure = readFile("components/setup/steps/step-infrastructure.tsx")
    const connection = readFile("components/setup/steps/step-connection.tsx")
    const tailscale = readFile("components/setup/steps/step-tailscale-lockdown.tsx")
    const creds = readFile("components/setup/steps/step-creds.tsx")
    const deploy = readFile("components/setup/steps/step-deploy.tsx")
    const badge = readFile("components/setup/steps/setup-save-state-badge.tsx")

    expect(infrastructure).toContain("SetupSaveStateBadge")
    expect(infrastructure).toContain("const hcloudSaveState")
    expect(infrastructure).toContain("headerBadge={<SetupSaveStateBadge state={configSaveState} />}")
    expect(infrastructure).not.toContain("SetupStepStatusBadge")
    expect(connection).toContain("SetupSaveStateBadge")
    expect(connection).not.toContain("SetupStepStatusBadge")
    expect(tailscale).toContain("SetupSaveStateBadge")
    expect(tailscale).not.toContain("SetupStepStatusBadge")
    expect(creds).toContain("SetupSaveStateBadge")
    expect(creds).not.toContain("SetupStepStatusBadge")
    expect(deploy).not.toContain("SetupStepStatusBadge")
    expect(badge).toContain('state === "saving"')
  })
})
