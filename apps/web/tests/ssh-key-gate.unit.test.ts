import { describe, expect, it } from "vitest"

import { deriveSshKeyGateUi } from "../src/lib/setup/ssh-key-gate"

describe("ssh key gate ui", () => {
  it("does nothing when runner is offline", () => {
    expect(deriveSshKeyGateUi({
      runnerOnline: false,
      hasDesiredSshKeys: false,
      probePending: false,
      probeError: false,
    })).toEqual({
      blocked: false,
      variant: "default",
      title: null,
      message: null,
    })
  })

  it("does nothing when keys are present", () => {
    expect(deriveSshKeyGateUi({
      runnerOnline: true,
      hasDesiredSshKeys: true,
      probePending: false,
      probeError: false,
    })).toEqual({
      blocked: false,
      variant: "default",
      title: null,
      message: null,
    })
  })

  it("shows pending messaging while probe is running", () => {
    const out = deriveSshKeyGateUi({
      runnerOnline: true,
      hasDesiredSshKeys: false,
      probePending: true,
      probeError: false,
    })
    expect(out.blocked).toBe(true)
    expect(out.variant).toBe("default")
    expect(out.title).toMatch(/checking ssh keys/i)
  })

  it("shows safe error messaging on probe error", () => {
    const out = deriveSshKeyGateUi({
      runnerOnline: true,
      hasDesiredSshKeys: false,
      probePending: false,
      probeError: true,
    })
    expect(out.blocked).toBe(true)
    expect(out.variant).toBe("destructive")
    expect(out.title).toMatch(/unavailable/i)
    expect(out.message).toMatch(/unable to verify/i)
  })
})

