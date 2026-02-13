import { describe, expect, it } from "vitest"
import { deriveHostSetupStepper, deriveSetupModel } from "../src/lib/setup/setup-model"

const baseConfig = {
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
  fleet: {
    sshAuthorizedKeys: ["ssh-ed25519 AAAATEST fleet"],
  },
}

function withDeployCredsDraftSet() {
  return {
    sealedSecretDrafts: {
      deployCreds: { status: "set" as const },
    },
  }
}

describe("deriveSetupModel", () => {
  it("starts at infrastructure and locks downstream steps when host config is missing", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
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
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.activeStepId).toBe("deploy")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })

  it("keeps tailscale lockdown incomplete when enabled and no key is configured", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      useTailscaleLockdown: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("active")
    expect(model.activeStepId).toBe("tailscale-lockdown")
  })

  it("marks tailscale lockdown complete when a key is already configured", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      useTailscaleLockdown: true,
      hasTailscaleAuthKey: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("keeps infrastructure active when deploy credentials draft is missing", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
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

  it("marks infrastructure done when deploy credentials draft is set", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("uses pending non-secret edits to unlock downstream steps before final commit", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner" },
            hetzner: { serverType: "", location: "" },
          },
        },
        fleet: { sshAuthorizedKeys: [] },
      },
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      pendingNonSecretDraft: {
        infrastructure: {
          serverType: "cpx22",
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
    expect(model.steps.find((s) => s.id === "predeploy")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("resumes step completion from setup draft values", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner" },
            hetzner: { serverType: "", location: "" },
          },
        },
        fleet: { sshAuthorizedKeys: [] },
      },
      hostFromRoute: "h1",
      setupDraft: {
        nonSecretDraft: {
          infrastructure: {
            serverType: "cpx22",
            location: "nbg1",
          },
          connection: {
            adminCidr: "203.0.113.10/32",
            sshKeyCount: 1,
            sshAuthorizedKeys: ["ssh-ed25519 AAAATEST draft"],
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

  it("treats draft SSH keys as connection-ready even when config fleet keys are empty (#222 regression)", () => {
    const model = deriveSetupModel({
      config: {
        hosts: {
          h1: {
            provisioning: { provider: "hetzner" },
            hetzner: { serverType: "cpx22", location: "nbg1" },
          },
        },
        fleet: { sshAuthorizedKeys: [] },
      },
      hostFromRoute: "h1",
      setupDraft: {
        nonSecretDraft: {
          connection: {
            adminCidr: "203.0.113.10/32",
            sshAuthorizedKeys: ["ssh-ed25519 AAAATEST draft"],
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

    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "predeploy")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })
})

describe("deriveHostSetupStepper", () => {
  it("keeps canonical setup step order", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
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
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    const stepper = deriveHostSetupStepper({ steps: model.steps, activeStepId: model.activeStepId })
    expect(stepper.activeStepId).toBe("deploy")
    expect(stepper.steps.find((s) => s.id === "deploy")?.status).toBe("locked")
  })
})
