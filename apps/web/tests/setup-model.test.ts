import { describe, expect, it } from "vitest"
import { deriveHostSetupStepper, deriveSetupModel } from "../src/lib/setup/setup-model"

describe("deriveSetupModel", () => {
  const infrastructureConfig = {
    hosts: {
      h1: {
        provisioning: { provider: "hetzner" },
        hetzner: {
          serverType: "cx43",
          image: "",
          location: "nbg1",
          allowTailscaleUdpIngress: true,
        },
      },
    },
  }

  it("starts at infrastructure and locks downstream steps when host config is missing", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      deployCreds: null,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.selectedHost).toBe("h1")
    expect(model.activeStepId).toBe("infrastructure")
    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "predeploy")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("locked")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })

  it("keeps requested step selected even when locked", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      stepFromSearch: "deploy",
      deployCreds: null,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.activeStepId).toBe("deploy")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })

  it("keeps tailscale lockdown incomplete when enabled and no key is configured", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
            hetzner: {
              serverType: "cx43",
              image: "",
              location: "nbg1",
              allowTailscaleUdpIngress: true,
            },
          },
        },
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      },
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "HCLOUD_TOKEN", status: "set" as const },
          { key: "GITHUB_TOKEN", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      useTailscaleLockdown: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("active")
    expect(model.activeStepId).toBe("tailscale-lockdown")
  })

  it("marks tailscale lockdown complete when a key is already configured", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
            hetzner: {
              serverType: "cx43",
              image: "",
              location: "nbg1",
              allowTailscaleUdpIngress: true,
            },
          },
        },
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      },
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "HCLOUD_TOKEN", status: "set" as const },
          { key: "GITHUB_TOKEN", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      useTailscaleLockdown: true,
      hasTailscaleAuthKey: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("keeps infrastructure active when HCLOUD draft secret is missing", () => {
    const model = deriveSetupModel({
      config: infrastructureConfig,
      hostFromRoute: "h1",
      deployCreds: null,
      setupDraft: {
        sealedSecretDrafts: {
          deployCreds: { status: "missing" },
        },
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("active")
    expect(model.activeStepId).toBe("infrastructure")
  })

  it("marks infrastructure done when HCLOUD draft secret is set", () => {
    const model = deriveSetupModel({
      config: infrastructureConfig,
      hostFromRoute: "h1",
      deployCreds: null,
      setupDraft: {
        sealedSecretDrafts: {
          deployCreds: { status: "set" },
        },
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.activeStepId).toBe("connection")
  })

  it("walks through required setup steps", () => {
    const step1 = deriveSetupModel({
      config: infrastructureConfig,
      hostFromRoute: "h1",
      deployCreds: { keys: [] },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step1.activeStepId).toBe("infrastructure")

    const step2 = deriveSetupModel({
      config: infrastructureConfig,
      hostFromRoute: "h1",
      deployCreds: {
        keys: [{ key: "HCLOUD_TOKEN", status: "set" as const }],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step2.activeStepId).toBe("connection")

    const connectionConfig = {
      ...infrastructureConfig,
      fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
      hosts: {
        h1: {
          provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
          hetzner: {
            serverType: "cx43",
            image: "",
            location: "nbg1",
            allowTailscaleUdpIngress: true,
          },
        },
      },
    }

    const step3 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: {
        keys: [{ key: "HCLOUD_TOKEN", status: "set" as const }],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step3.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(step3.activeStepId).toBe("predeploy")

    const readyCreds = {
      keys: [
        { key: "HCLOUD_TOKEN", status: "set" as const },
        { key: "GITHUB_TOKEN", status: "set" as const },
        { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
      ],
    }

    const step4 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step4.activeStepId).toBe("deploy")
    expect(step4.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")

    const step5 = deriveSetupModel({
      config: connectionConfig,
      hostFromRoute: "h1",
      deployCreds: readyCreds,
      latestBootstrapRun: { status: "succeeded" },
      latestBootstrapSecretsVerifyRun: null,
    })
    expect(step5.hasBootstrapped).toBe(true)
    expect(step5.showCelebration).toBe(true)
    expect(step5.steps.find((s) => s.id === "verify")?.status).toBe("pending")
  })

  it("uses pending non-secret edits to unlock downstream steps before final commit", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner" },
            hetzner: {
              serverType: "",
              location: "",
            },
          },
        },
      },
      hostFromRoute: "h1",
      deployCreds: {
        keys: [{ key: "HCLOUD_TOKEN", status: "set" as const }],
      },
      pendingNonSecretDraft: {
        infrastructure: {
          serverType: "cx22",
          location: "nbg1",
        },
        connection: {
          adminCidr: "203.0.113.10/32",
          sshKeyCount: 1,
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST pending"],
        },
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("predeploy")
  })

  it("resumes step completion from setup draft values", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner" },
            hetzner: {
              serverType: "",
              location: "",
            },
          },
        },
      },
      hostFromRoute: "h1",
      deployCreds: { keys: [] },
      setupDraft: {
        nonSecretDraft: {
          infrastructure: {
            serverType: "cx22",
            location: "nbg1",
          },
          connection: {
            adminCidr: "203.0.113.10/32",
            sshKeyCount: 1,
          },
        },
        sealedSecretDrafts: {
          deployCreds: { status: "set" },
        },
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "predeploy")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })
})

describe("deriveHostSetupStepper", () => {
  it("keeps canonical setup step order", () => {
    const model = deriveSetupModel({
      config: {
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"] },
        hosts: {
          h1: {
            provisioning: { provider: "hetzner", adminCidr: "203.0.113.10/32" },
            hetzner: {
              serverType: "cx43",
              image: "",
              location: "nbg1",
              allowTailscaleUdpIngress: true,
            },
          },
        },
      },
      hostFromRoute: "h1",
      deployCreds: {
        keys: [
          { key: "HCLOUD_TOKEN", status: "set" as const },
          { key: "GITHUB_TOKEN", status: "set" as const },
          { key: "SOPS_AGE_KEY_FILE", status: "set" as const },
        ],
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    const stepper = deriveHostSetupStepper({ steps: model.steps, activeStepId: model.activeStepId })
    expect(stepper.steps.map((s) => s.id)).toEqual([
      "infrastructure",
      "connection",
      "tailscale-lockdown",
      "predeploy",
      "deploy",
      "verify",
    ])
    expect(stepper.activeStepId).toBe("deploy")
  })

  it("keeps selected step even if locked", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      stepFromSearch: "deploy",
      deployCreds: null,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    const stepper = deriveHostSetupStepper({ steps: model.steps, activeStepId: model.activeStepId })
    expect(stepper.activeStepId).toBe("deploy")
    expect(stepper.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })
})
