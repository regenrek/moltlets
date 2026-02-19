import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup deploy two-phase flow", () => {
  it("requires predeploy green before deploy and exposes both CTAs", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")
    const setupDeployStep = readFile("components/setup/steps/step-deploy.tsx")

    expect(source).toContain("Run predeploy")
    expect(source).toContain("Deploy now")
    expect(source).toContain("Run predeploy checks first and confirm green summary.")
    expect(source).toContain("Server access incomplete. Set admin password.")
    expect(source).toContain("bootstrapSecretsPayload.adminPassword =")
    expect(source).toContain("const runPredeploy = useMutation(")
    expect(source).toContain("Predeploy summary")
    expect(source).toContain("bootstrapFinalizeArmed")
    expect(source).toContain("latestLockdownRunQuery")
    expect(source).toContain("latestApplyRunQuery")
    expect(source).toContain("kind: \"server_update_apply\"")
    expect(source).toContain("const shouldAutoStartFinalize = isBootstrapped")
    expect(source).toContain("const effectiveFinalizeState: FinalizeState")
    expect(source).toContain("Preparing post-bootstrap hardening...")
    expect(source).toContain("Activate VPN & lockdown")
    expect(source).toContain("Lockdown summary")
    expect(source).toContain("Install OpenClaw")
    expect(source).not.toContain("Continue to verify")
    expect(source).not.toContain("setupDraftVersion")
    expect(source).toContain("const predeployFingerprintRef = useRef(predeployFingerprint)")
    expect(source).toContain("setPredeployReadyFingerprint(predeployFingerprintNow)")
    expect(source).not.toContain("Deploy checks load when this section is active.")
    expect(setupDeployStep).not.toContain("setupChecksEnabled")
  })
})
