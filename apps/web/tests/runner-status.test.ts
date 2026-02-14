import { describe, expect, it } from "vitest"
import {
  RUNNER_FRESHNESS_MS,
  deriveProjectRunnerNixReadiness,
  isProjectRunnerOnline,
  isRunnerFreshOnline,
} from "../src/lib/setup/runner-status"

describe("runner status helpers", () => {
  it("marks runner online only when status is online and fresh", () => {
    const now = 1_700_000_000_000
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: now - 1 }, now)).toBe(true)
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: now - RUNNER_FRESHNESS_MS }, now)).toBe(true)
    expect(isRunnerFreshOnline({ lastStatus: "offline", lastSeenAt: now - 1 }, now)).toBe(false)
    expect(isRunnerFreshOnline({ lastStatus: "online", lastSeenAt: null }, now)).toBe(false)
  })

  it("derives project runner online state from runner list", () => {
    const now = 1_700_000_000_000
    expect(isProjectRunnerOnline([], now)).toBe(false)
    expect(isProjectRunnerOnline(null, now)).toBe(false)
    expect(
      isProjectRunnerOnline(
        [
          { lastStatus: "offline", lastSeenAt: now - 1000 },
          { lastStatus: "online", lastSeenAt: now - 1000 },
        ],
        now,
      ),
    ).toBe(true)
    expect(
      isProjectRunnerOnline(
        [
          { lastStatus: "online", lastSeenAt: now - RUNNER_FRESHNESS_MS - 1 },
        ],
        now,
      ),
    ).toBe(false)
  })

  it("derives nix readiness from fresh runners", () => {
    const now = 1_700_000_000_000
    expect(deriveProjectRunnerNixReadiness([], now)).toEqual({
      ready: false,
      hasFreshOnlineRunner: false,
    })
    expect(
      deriveProjectRunnerNixReadiness(
        [
          {
            runnerName: "alpha",
            lastStatus: "online",
            lastSeenAt: now - 1_000,
            capabilities: { hasNix: false },
          },
        ],
        now,
      ),
    ).toEqual({
      ready: false,
      hasFreshOnlineRunner: true,
    })

    const ready = deriveProjectRunnerNixReadiness(
      [
        {
          runnerName: "alpha",
          lastStatus: "online",
          lastSeenAt: now - 1_000,
          capabilities: { hasNix: true, nixVersion: "nix (Nix) 2.24.9", nixBin: "/nix/bin/nix" },
        },
      ],
      now,
    )
    expect(ready.ready).toBe(true)
    expect(ready.runnerName).toBe("alpha")
    expect(ready.nixVersion).toBe("nix (Nix) 2.24.9")
    expect(ready.nixBin).toBe("/nix/bin/nix")
  })

  it("selects the freshest ready runner across multiple online runners", () => {
    const now = 1_700_000_000_000
    const ready = deriveProjectRunnerNixReadiness(
      [
        {
          runnerName: "older-ready",
          lastStatus: "online",
          lastSeenAt: now - 2_000,
          capabilities: { hasNix: true, nixVersion: "nix (Nix) 2.24.0" },
        },
        {
          runnerName: "freshest-ready",
          lastStatus: "online",
          lastSeenAt: now - 200,
          capabilities: { hasNix: true, nixVersion: "nix (Nix) 2.26.0" },
        },
        {
          runnerName: "stale-ready",
          lastStatus: "online",
          lastSeenAt: now - RUNNER_FRESHNESS_MS - 1,
          capabilities: { hasNix: true, nixVersion: "nix (Nix) 2.20.0" },
        },
      ],
      now,
    )
    expect(ready.ready).toBe(true)
    expect(ready.runnerName).toBe("freshest-ready")
    expect(ready.nixVersion).toBe("nix (Nix) 2.26.0")
  })

  it("ignores stale nix-capable runners when only fresh runner lacks nix", () => {
    const now = 1_700_000_000_000
    expect(
      deriveProjectRunnerNixReadiness(
        [
          {
            runnerName: "fresh-no-nix",
            lastStatus: "online",
            lastSeenAt: now - 100,
            capabilities: { hasNix: false },
          },
          {
            runnerName: "stale-nix",
            lastStatus: "online",
            lastSeenAt: now - RUNNER_FRESHNESS_MS - 1,
            capabilities: { hasNix: true, nixVersion: "nix (Nix) 2.24.9" },
          },
        ],
        now,
      ),
    ).toEqual({
      ready: false,
      hasFreshOnlineRunner: true,
    })
  })
})
