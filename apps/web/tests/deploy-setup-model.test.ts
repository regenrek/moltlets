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
      dirty: false,
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
      dirty: false,
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
      dirty: false,
      missingRev: false,
      needsPush: false,
      localSelected: false,
    })
    expect(result.reason).toBe("ready")
    expect(result.blocksDeploy).toBe(false)
    expect(result.showFirstPushGuidance).toBe(false)
  })

  it("blocks deploy when repo is dirty", () => {
    const result = deriveDeployReadiness({
      runnerOnline: true,
      repoPending: false,
      repoError: null,
      dirty: true,
      missingRev: false,
      needsPush: false,
      localSelected: false,
    })
    expect(result.reason).toBe("dirty_repo")
    expect(result.blocksDeploy).toBe(true)
  })
})

describe("deriveFirstPushGuidance", () => {
  it("returns remote-setup commands when upstream is missing", () => {
    const result = deriveFirstPushGuidance({
      upstream: null,
      runnerRepoPath: "~/.clawlets/projects/openclaw-fleet",
      repoUrlHint: "git@github.com:org/openclaw-fleet.git",
    })
    expect(result.hasUpstream).toBe(false)
    expect(result.remoteName).toBe("origin")
    expect(result.repoPath).toBe("~/.clawlets/projects/openclaw-fleet")
    expect(result.repoUrlHint).toBe("git@github.com:org/openclaw-fleet.git")
    expect(result.commands).toContain("cd \"$HOME\"'/.clawlets/projects/openclaw-fleet'")
    expect(result.commands).toContain("git remote add origin 'git@github.com:org/openclaw-fleet.git'")
    expect(result.commands).toContain("git remote set-url origin 'git@github.com:org/openclaw-fleet.git'")
    expect(result.commands).toContain("git push -u origin HEAD")
  })

  it("returns simple push when upstream exists", () => {
    const result = deriveFirstPushGuidance({
      upstream: "origin/main",
      runnerRepoPath: "/srv/openclaw",
    })
    expect(result.hasUpstream).toBe(true)
    expect(result.remoteName).toBe("origin")
    expect(result.commands).toBe("cd '/srv/openclaw'\ngit push")
  })

  it("keeps placeholders when repo hints are missing", () => {
    const result = deriveFirstPushGuidance({ upstream: null })
    expect(result.commands).toContain("cd <runner-repo-path>")
    expect(result.commands).toContain("git remote add origin <repo-url>")
  })
})
