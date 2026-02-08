import { describe, expect, it } from "vitest"
import { deriveOpenClawSetupModel } from "../src/lib/setup/openclaw-setup-model"

describe("deriveOpenClawSetupModel", () => {
  it("locks setup when host is missing", () => {
    const model = deriveOpenClawSetupModel({
      config: null,
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: null,
      latestUpdateApplyRun: null,
    })
    expect(model.selectedHost).toBe(null)
    expect(model.activeStepId).toBe("enable")
    expect(model.steps.find((s) => s.id === "enable")?.status).toBe("locked")
  })

  it("walks through openclaw setup steps", () => {
    const disabled = deriveOpenClawSetupModel({
      config: {
        hosts: {
          h1: {
            openclaw: { enable: false },
            gatewaysOrder: [],
            gateways: {},
          },
        },
      },
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: null,
      latestUpdateApplyRun: null,
    })
    expect(disabled.activeStepId).toBe("enable")

    const noGateway = deriveOpenClawSetupModel({
      config: {
        hosts: {
          h1: {
            openclaw: { enable: true },
            gatewaysOrder: [],
            gateways: {},
          },
        },
      },
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: null,
      latestUpdateApplyRun: null,
    })
    expect(noGateway.activeStepId).toBe("gateway")

    const needsSecrets = deriveOpenClawSetupModel({
      config: {
        hosts: {
          h1: {
            openclaw: { enable: true },
            gatewaysOrder: ["g1"],
            gateways: { g1: {} },
          },
        },
      },
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: null,
      latestUpdateApplyRun: null,
    })
    expect(needsSecrets.activeStepId).toBe("secrets")

    const needsDeploy = deriveOpenClawSetupModel({
      config: {
        hosts: {
          h1: {
            openclaw: { enable: true },
            gatewaysOrder: ["g1"],
            gateways: { g1: {} },
          },
        },
      },
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: { status: "succeeded" },
      latestUpdateApplyRun: null,
    })
    expect(needsDeploy.activeStepId).toBe("deploy")

    const done = deriveOpenClawSetupModel({
      config: {
        hosts: {
          h1: {
            openclaw: { enable: true },
            gatewaysOrder: ["g1"],
            gateways: { g1: {} },
          },
        },
      },
      hostFromRoute: "h1",
      latestOpenClawSecretsVerifyRun: { status: "succeeded" },
      latestUpdateApplyRun: { status: "succeeded" },
    })
    expect(done.showCelebration).toBe(true)
  })
})
