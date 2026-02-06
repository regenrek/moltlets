import { describe, expect, it } from "vitest"
import { deriveSetupModel } from "../src/lib/setup/setup-model"

describe("deriveSetupModel", () => {
  it("starts at host when config missing", () => {
    const model = deriveSetupModel({
      config: null,
      deployCreds: null,
      latestBootstrapRun: null,
      latestSecretsVerifyRun: null,
    })
    expect(model.selectedHost).toBe(null)
    expect(model.activeStepId).toBe("host")
    expect(model.steps.find((s) => s.id === "host")?.status).toBe("active")
  })

  it("walks through required steps", () => {
    const baseConfig = {
      defaultHost: "h1",
      hosts: { h1: {} },
    }

    const step1 = deriveSetupModel({
      config: baseConfig,
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestSecretsVerifyRun: null,
    })
    expect(step1.selectedHost).toBe("h1")
    expect(step1.activeStepId).toBe("connection")

    const connectionConfig = {
      ...baseConfig,
      fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      hosts: {
        h1: {
          provisioning: { adminCidr: "203.0.113.10/32" },
        },
      },
    }

    const step2 = deriveSetupModel({
      config: connectionConfig,
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestSecretsVerifyRun: null,
    })
    expect(step2.activeStepId).toBe("secrets")

    const step3 = deriveSetupModel({
      config: connectionConfig,
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step3.activeStepId).toBe("creds")

    const readyCreds = {
      keys: [
        { key: "HCLOUD_TOKEN", status: "set" as const },
        { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
      ],
    }

    const step4 = deriveSetupModel({
      config: connectionConfig,
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step4.activeStepId).toBe("deploy")

    const step5 = deriveSetupModel({
      config: connectionConfig,
      deployCreds: readyCreds,
      latestBootstrapRun: { status: "succeeded" },
      latestSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step5.hasBootstrapped).toBe(true)
    expect(step5.steps.find((s) => s.id === "verify")?.status).toBe("pending")
  })
})
