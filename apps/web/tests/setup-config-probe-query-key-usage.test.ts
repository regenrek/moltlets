import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup probe query key usage", () => {
  it("uses canonical setup probe key/options in setup consumers", () => {
    const useSetupModel = readFile("lib/setup/use-setup-model.ts")
    const runnerStatusControl = readFile("components/layout/runner-status-control.tsx")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")
    const stepHost = readFile("components/setup/steps/step-host.tsx")
    const stepConnection = readFile("components/setup/steps/step-connection.tsx")

    expect(useSetupModel).toContain("setupConfigProbeQueryOptions")
    expect(runnerStatusControl).toContain("setupConfigProbeQueryOptions")
    expect(deploySetup).toContain("setupConfigProbeQueryOptions")
    expect(stepHost).toContain("setupConfigProbeQueryKey")
    expect(stepConnection).toContain("setupConfigProbeQueryKey")

    expect(`${useSetupModel}\n${runnerStatusControl}\n${deploySetup}\n${stepHost}\n${stepConnection}`)
      .not.toContain("hostSetupConfig")
  })
})
