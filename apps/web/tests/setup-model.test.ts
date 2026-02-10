import { describe, expect, it } from "vitest"
import { deriveSetupModel } from "../src/lib/setup/setup-model"

describe("deriveSetupModel", () => {
  it("keeps runner step active when runner is offline", () => {
    const model = deriveSetupModel({
      runnerOnline: false,
      repoProbeOk: false,
      config: null,
      hostFromRoute: "h1",
      deployCreds: null,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(model.selectedHost).toBe(null)
    expect(model.activeStepId).toBe("runner")
    expect(model.steps.find((s) => s.id === "runner")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "host")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("locked")
  })

  it("locks downstream steps until runner and repo probe are ready", () => {
    const model = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: false,
      config: {
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
        hosts: {
          h1: {
            provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
          },
        },
      },
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "HCLOUD_TOKEN", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      latestBootstrapRun: { status: "succeeded" },
      latestBootstrapSecretsVerifyRun: { status: "succeeded" },
    })
    expect(model.steps.find((s) => s.id === "runner")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "host")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })

  it("keeps host step active when no hosts exist", () => {
    const model = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
      config: { hosts: {}, fleet: { sshAuthorizedKeys: [] } },
      hostFromRoute: "setup-runner",
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(model.activeStepId).toBe("host")
    expect(model.steps.find((s) => s.id === "host")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("locked")
  })

  it("walks through required setup steps for hetzner", () => {
    const baseConfig = {
      defaultHost: "h1",
      hosts: { h1: { provisioning: { provider: "hetzner" } } },
    }

    const step1 = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
      config: baseConfig,
      hostFromRoute: "h1",
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step1.activeStepId).toBe("connection")
    expect(step1.steps.find((s) => s.id === "host")?.status).toBe("done")

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
      runnerOnline: true,
      repoProbeOk: true,
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
      runnerOnline: true,
      repoProbeOk: true,
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step3.activeStepId).toBe("secrets")

    const step4 = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: { status: "succeeded" },
    })
    expect(step4.activeStepId).toBe("deploy")

    const step5 = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
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

  it("keeps hetzner token gate even when host provider is aws", () => {
    const config = {
      fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      hosts: {
        h1: {
          provisioning: { provider: "aws", adminCidr: "203.0.113.10/32" },
        },
      },
    }

    const missingAwsCreds = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
      config,
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(missingAwsCreds.steps.find((s) => s.id === "creds")?.status).toBe("active")

    const hcloudCreds = deriveSetupModel({
      runnerOnline: true,
      repoProbeOk: true,
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
    expect(hcloudCreds.steps.find((s) => s.id === "creds")?.status).toBe("done")
  })
})
