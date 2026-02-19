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
      hostBootstrapCreds: { status: "set" as const },
    },
  }
}

describe("deriveSetupModel", () => {
  it("starts at infrastructure and keeps all setup steps visible when host config is missing", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.selectedHost).toBe("h1")
    expect(model.activeStepId).toBe("infrastructure")
    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "creds")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("active")
  })

  it("keeps requested step selected", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      stepFromSearch: "deploy",
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.activeStepId).toBe("deploy")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("active")
  })

  it("keeps tailscale lockdown incomplete when enabled and no key is configured", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
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
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      useTailscaleLockdown: true,
      hasHostTailscaleAuthKey: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("marks tailscale lockdown complete when host secret is configured", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      useTailscaleLockdown: true,
      hasHostTailscaleAuthKey: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("keeps tailscale lockdown incomplete when host secret is missing", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      useTailscaleLockdown: true,
      hasHostTailscaleAuthKey: false,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("active")
    expect(model.activeStepId).toBe("tailscale-lockdown")
  })

  it("keeps infrastructure active when deploy credentials draft is missing", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: {
        sealedSecretDrafts: {
          hostBootstrapCreds: { status: "missing" },
        },
      },
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("active")
    expect(model.activeStepId).toBe("infrastructure")
  })

  it("marks infrastructure done when active Hetzner key is selected", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })

  it("activates creds step when GitHub token is missing even if Hetzner setup is complete", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      hasActiveHcloudToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "creds")?.status).toBe("active")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("active")
    expect(model.activeStepId).toBe("creds")
  })

  it("unlocks deploy when project deploy creds exist even without a host draft section", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "deploy")?.status).toBe("active")
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
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
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
    expect(model.steps.find((s) => s.id === "creds")?.status).toBe("done")
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
          hostBootstrapCreds: { status: "set" },
        },
      },
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "tailscale-lockdown")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "creds")?.status).toBe("done")
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
          hostBootstrapCreds: { status: "set" },
        },
      },
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    expect(model.steps.find((s) => s.id === "connection")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "infrastructure")?.status).toBe("done")
    expect(model.steps.find((s) => s.id === "creds")?.status).toBe("done")
    expect(model.activeStepId).toBe("deploy")
  })
})

describe("deriveHostSetupStepper", () => {
  it("keeps canonical setup step order", () => {
    const model = deriveSetupModel({
      config: baseConfig,
      hostFromRoute: "h1",
      setupDraft: withDeployCredsDraftSet(),
      hasActiveHcloudToken: true,
      hasProjectGithubToken: true,
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    const stepper = deriveHostSetupStepper({ steps: model.steps, activeStepId: model.activeStepId })
    expect(stepper.steps.map((s) => s.id)).toEqual([
      "infrastructure",
      "connection",
      "tailscale-lockdown",
      "creds",
      "deploy",
    ])
    expect(stepper.activeStepId).toBe("deploy")
  })

  it("keeps selected step when requested", () => {
    const model = deriveSetupModel({
      config: null,
      hostFromRoute: "h1",
      stepFromSearch: "deploy",
      latestBootstrapRun: null,
      latestBootstrapSecretsVerifyRun: null,
    })

    const stepper = deriveHostSetupStepper({ steps: model.steps, activeStepId: model.activeStepId })
    expect(stepper.activeStepId).toBe("deploy")
    expect(stepper.steps.find((s) => s.id === "deploy")?.status).toBe("active")
  })
})
