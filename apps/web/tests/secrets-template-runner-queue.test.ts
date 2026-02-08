import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadSdk() {
  vi.resetModules()
  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }))
  const config = {
    defaultHost: "alpha",
    fleet: {},
    hosts: { alpha: { gatewaysOrder: ["gateway-1"], gateways: { "gateway-1": {} } } },
  }

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation: vi.fn(), query: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("@clawlets/core/lib/config/clawlets-config", () => ({
    ClawletsConfigSchema: {
      parse: () => config,
    },
  }))
  vi.doMock("@clawlets/core/lib/secrets/plan", () => ({
    buildFleetSecretsPlan: () => ({
      gateways: ["gateway-1"],
      missing: [],
      missingSecretConfig: [],
      required: [{ name: "DISCORD_TOKEN" }],
      optional: [],
      warnings: [],
    }),
  }))
  vi.doMock("@clawlets/core/lib/secrets/secrets-init-template", () => ({
    buildSecretsInitTemplateSets: () => ({
      requiresTailscaleAuthKey: false,
      requiresAdminPassword: false,
      templateSecrets: { DISCORD_TOKEN: "" },
      requiredSecretNames: ["DISCORD_TOKEN"],
    }),
  }))
  vi.doMock("@clawlets/core/lib/secrets/secrets-init", () => ({
    buildSecretsInitTemplate: ({ secrets }: { secrets: Record<string, string> }) => ({
      secrets,
    }),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand,
      waitForRunTerminal: async () => ({ status: "succeeded" }),
      listRunMessages: async () => [JSON.stringify(config)],
      parseLastJsonMessage: (messages: string[]) => JSON.parse(messages[messages.length - 1] || "{}"),
      lastErrorMessage: () => "config read failed",
    }
  })

  const mod = await import("~/sdk/secrets/init")
  return { mod, enqueueRunnerCommand }
}

describe("secrets template runner queue", () => {
  it("builds template from runner-fetched config", async () => {
    const { mod, enqueueRunnerCommand } = await loadSdk()
    const context = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(context, async () =>
      await mod.getSecretsTemplate({
        data: { projectId: "p1" as any, host: "alpha", scope: "all" },
      }),
    )

    expect(res.host).toBe("alpha")
    expect(res.requiredSecretNames).toEqual(["DISCORD_TOKEN"])
    expect(JSON.parse(res.templateJson)).toEqual({ secrets: { DISCORD_TOKEN: "" } })
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      args: ["config", "show", "--pretty=false"],
    }))
  })
})
