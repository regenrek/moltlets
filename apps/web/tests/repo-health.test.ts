import { describe, expect, it } from "vitest"
import { deriveRepoHealth, deriveRunnerHeaderState, REPO_HEALTH_FRESH_MS } from "../src/lib/setup/repo-health"

describe("repo health", () => {
  it("returns idle when runner is offline", () => {
    const health = deriveRepoHealth({
      runnerOnline: false,
      configs: [],
    })
    expect(health).toEqual({ state: "idle" })
  })

  it("returns checking until fleet metadata exists", () => {
    const health = deriveRepoHealth({
      runnerOnline: true,
      configs: [{ type: "host", lastSyncAt: Date.now() }],
    })
    expect(health).toEqual({ state: "checking" })
  })

  it("returns error when fleet metadata reports lastError", () => {
    const health = deriveRepoHealth({
      runnerOnline: true,
      configs: [{ type: "fleet", lastSyncAt: Date.now(), lastError: "config parse failed" }],
    })
    expect(health).toEqual({ state: "error", error: "config parse failed" })
  })

  it("redacts secret-like values in metadata error text", () => {
    const health = deriveRepoHealth({
      runnerOnline: true,
      configs: [{
        type: "fleet",
        lastSyncAt: Date.now(),
        lastError: "Authorization: Bearer secret123 https://user:pw@example.com?token=abc",
      }],
    })
    expect(health.state).toBe("error")
    expect(health.error).toContain("Authorization: Bearer <redacted>")
    expect(health.error).toContain("https://<redacted>@example.com?token=<redacted>")
    expect(health.error).not.toContain("secret123")
  })

  it("returns checking when fleet metadata is stale", () => {
    const now = 500_000
    const health = deriveRepoHealth({
      runnerOnline: true,
      now,
      configs: [{ type: "fleet", lastSyncAt: now - REPO_HEALTH_FRESH_MS - 1 }],
    })
    expect(health).toEqual({ state: "checking" })
  })

  it("returns ok when fleet metadata is fresh and clean", () => {
    const now = 500_000
    const health = deriveRepoHealth({
      runnerOnline: true,
      now,
      configs: [{ type: "fleet", lastSyncAt: now - 5_000 }],
    })
    expect(health).toEqual({ state: "ok" })
  })
})

describe("runner header state", () => {
  it("maps repo health to header state", () => {
    expect(deriveRunnerHeaderState({ runnerOnline: false, repoHealthState: "checking" })).toBe("offline")
    expect(deriveRunnerHeaderState({ runnerOnline: true, repoHealthState: "checking" })).toBe("connecting")
    expect(deriveRunnerHeaderState({ runnerOnline: true, repoHealthState: "error" })).toBe("connecting")
    expect(deriveRunnerHeaderState({ runnerOnline: true, repoHealthState: "ok" })).toBe("ready")
  })
})
