import { describe, expect, it } from "vitest"
import {
  deriveDeployReadiness,
  deriveFirstPushGuidance,
} from "../src/components/deploy/deploy-setup-model"

describe("deriveDeployReadiness", () => {
  it("flags missing remote revision with actionable first-push guidance", () => {
    const result = deriveDeployReadiness({
      runnerOnline: true,
      repoPending: false,
      repoError: null,
      missingRev: true,
      needsPush: false,
      localSelected: false,
    })
    expect(result.reason).toBe("missing_remote_rev")
    expect(result.blocksDeploy).toBe(true)
    expect(result.showFirstPushGuidance).toBe(true)
    expect(result.title).toBe("No pushed revision found")
  })

  it("flags local needs-push state as warning with first-push guidance", () => {
    const result = deriveDeployReadiness({
      runnerOnline: true,
      repoPending: false,
      repoError: null,
      missingRev: false,
      needsPush: true,
      localSelected: true,
    })
    expect(result.reason).toBe("needs_push")
    expect(result.severity).toBe("warning")
    expect(result.blocksDeploy).toBe(true)
    expect(result.showFirstPushGuidance).toBe(true)
  })

  it("returns ready state when all gates pass", () => {
    const result = deriveDeployReadiness({
      runnerOnline: true,
      repoPending: false,
      repoError: null,
      missingRev: false,
      needsPush: false,
      localSelected: false,
    })
    expect(result.reason).toBe("ready")
    expect(result.blocksDeploy).toBe(false)
    expect(result.showFirstPushGuidance).toBe(false)
  })
})

describe("deriveFirstPushGuidance", () => {
  it("returns remote-setup commands when upstream is missing", () => {
    const result = deriveFirstPushGuidance({ upstream: null })
    expect(result.hasUpstream).toBe(false)
    expect(result.remoteName).toBe("origin")
    expect(result.commands).toContain("git remote add origin <repo-url>")
    expect(result.commands).toContain("git remote set-url origin <repo-url>")
    expect(result.commands).toContain("git push -u origin HEAD")
  })

  it("returns simple push when upstream exists", () => {
    const result = deriveFirstPushGuidance({ upstream: "origin/main" })
    expect(result.hasUpstream).toBe(true)
    expect(result.remoteName).toBe("origin")
    expect(result.commands).toBe("git push")
  })
})
