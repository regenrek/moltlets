import { describe, expect, it } from "vitest"
import { deriveSetupModel } from "../src/lib/setup/setup-model"

describe("deriveSetupModel", () => {
  it("locks setup when host is missing", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      deployCreds: null,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(model.selectedHost).toBe(null)
    expect(model.activeStepId).toBe("connection")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("locked")
  })

  it("walks through required setup steps for hetzner", () => {
    const baseConfig = {
      defaultHost: "h1",
      hosts: { h1: { provisioning: { provider: "hetzner" } } },
    }

    const step1 = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step1.activeStepId).toBe("connection")

    const connectionConfig = {
      ...baseConfig,
      fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      hosts: {
        h1: {
          provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
        },
      },
    }

    const step2 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step2.activeStepId).toBe("creds")

    const readyCreds = {
      keys: [
        { key: "HCLOUD_TOKEN", status: "set" as const },
        { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
      ],
    }

    const step3 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step3.activeStepId).toBe("secrets")

    const step4 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step4.activeStepId).toBe("deploy")

    const step5 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: { status: "succeeded" },
      latestBootstrapSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step5.hasBootstrapped).toBe(true)
    expect(step5.showCelebration).toBe(true)
    expect(step5.steps.find((s) => s.id === "verify")?.status).toBe("pending")
  })

  it("requires aws provider tokens for aws hosts", () => {
    const config = {
      fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      hosts: {
        h1: {
          provisioning: { provider: "aws", adminCidr: "203.0.113.10/32" },
        },
      },
    }

    const missingAwsCreds = deriveSetupModel({
      config,
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "HCLOUD_TOKEN", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(missingAwsCreds.steps.find((s) => s.id === "creds")?.status).toBe("active")

    const awsCreds = deriveSetupModel({
      config,
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "AWS_ACCESS_KEY_ID", status: "set" as const },
          { key: "AWS_SECRET_ACCESS_KEY", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(awsCreds.steps.find((s) => s.id === "creds")?.status).toBe("done")
  })
})
