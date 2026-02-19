import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { PROJECT_TOKEN_VALUE_MAX_CHARS } from "~/lib/project-token-keyring"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function makeRunnerKeyMaterial() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
  const spki = pair.publicKey.export({ type: "spki", format: "der" })
  const spkiBuf = Buffer.isBuffer(spki) ? spki : Buffer.from(spki)
  return {
    keyId: toBase64Url(createHash("sha256").update(spkiBuf).digest()),
    publicKeySpkiB64: toBase64Url(spkiBuf),
  }
}

async function loadSdk(params: {
  runnerJson: Record<string, unknown>
  runners?: unknown[]
  commandResultJson?: Record<string, unknown> | null
}) {
  vi.resetModules()
  const runnerKeyMaterial = makeRunnerKeyMaterial()
  const mutation = vi.fn(async (_mutation: unknown, payload: any) => {
    const maybeTakeResult =
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.jobId === "string"
      && !("kind" in payload)
      && !("sealedInputB64" in payload)
    if (maybeTakeResult) {
      const result = params.commandResultJson ?? params.runnerJson
      return { runId: "run_1", resultJson: JSON.stringify(result) }
    }
    if (
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.targetRunnerId === "string"
      && typeof payload.kind === "string"
      && payload.payloadMeta
    ) {
      return {
        runId: "run_1",
        jobId: "job_1",
        kind: "custom",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: runnerKeyMaterial.keyId,
        sealedInputPubSpkiB64: runnerKeyMaterial.publicKeySpkiB64,
      }
    }
    if (
      payload
      && typeof payload === "object"
      && typeof payload.projectId === "string"
      && typeof payload.jobId === "string"
      && typeof payload.kind === "string"
      && typeof payload.sealedInputB64 === "string"
    ) {
      return { runId: "run_1", jobId: payload.jobId }
    }
    return null as any
  })
  const query = vi.fn(async () => params.runners || [])
  const enqueueRunnerCommandMock = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }))
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    getRepoRoot: async () => "/tmp/repo",
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand: enqueueRunnerCommandMock,
      waitForRunTerminal: async () => ({ status: "succeeded" }),
      listRunMessages: async () => [JSON.stringify(params.runnerJson)],
      parseLastJsonMessage: (messages: string[]) => {
        const raw = messages[messages.length - 1] || "{}"
        return JSON.parse(raw)
      },
      lastErrorMessage: () => "runner command failed",
    }
  })

  const mod = await import("~/sdk/infra/deploy-creds")
  return { mod, mutation, query, enqueueRunnerCommandMock }
}

describe("deploy creds runner queue", () => {
  it("reads detected age key candidates from runner JSON", async () => {
    const { mod } = await loadSdk({
      runnerJson: {
        operatorId: "alice",
        defaultOperatorPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
        candidates: [{ path: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey", exists: true, valid: true }],
        recommendedPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.detectSopsAgeKey({
        data: { projectId: "p1" as any },
      }),
    )
    expect(res.recommendedPath).toBe("/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey")
    expect(res.candidates[0]?.valid).toBe(true)
  })

  it("skips audit metadata when runner reuses existing age key", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        ok: true,
        keyPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
        publicKey: "age1test",
        created: false,
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.generateSopsAgeKey({
        data: { projectId: "p1" as any },
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.created).toBe(false)
    const payload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "sops.operatorKey.generate")?.[1]
    expect(payload).toBeUndefined()
  })

  it("records host-scoped audit target for setup host key generation", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        ok: true,
        keyPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/hosts/openclaw-fleet-host/alice.agekey",
        publicKey: "age1test",
        created: true,
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.generateSopsAgeKey({
        data: { projectId: "p1" as any, host: "openclaw-fleet-host" },
      }),
    )
    expect(res.ok).toBe(true)
    const payload = (mutation.mock.calls as any[])
      .find((call) => String(call?.[1]?.action || "") === "sops.operatorKey.generate")?.[1]
    expect(payload).toEqual({
      projectId: "p1",
      action: "sops.operatorKey.generate",
      target: { doc: "<runtimeDir>/keys/operators/hosts/openclaw-fleet-host" },
      data: { runId: "run_1" },
    })
  })

  it("rejects non host-scoped key path for host generation", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        ok: true,
        keyPath: "/tmp/clawlets-home/workspaces/repo-1234567890abcdef/keys/operators/alice.agekey",
        publicKey: "age1test",
        created: true,
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.generateSopsAgeKey({
        data: { projectId: "p1" as any, host: "openclaw-fleet-host" },
      }),
    )
    expect(res).toEqual({
      ok: false,
      message: "Runner returned non host-scoped SOPS key path.",
    })
    const payload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "sops.operatorKey.generate")?.[1]
    expect(payload).toBeUndefined()
  })

  it("queues deploy-creds sealed update", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {},
      runners: [
        {
          _id: "r1",
          runnerName: "runner-1",
          lastSeenAt: 100,
          lastStatus: "online",
          capabilities: {
            supportsSealedInput: true,
            sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
            sealedInputPubSpkiB64: "abc123",
            sealedInputKeyId: "kid123",
          },
        },
      ],
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const queued = await runWithStartContext(ctx, async () =>
      mod.queueDeployCredsUpdate({
        data: {
          projectId: "p1" as any,
          targetRunnerId: "r1",
          updates: {
            HCLOUD_TOKEN: "token-123",
          },
        },
      }),
    )
    expect(queued.ok).toBe(true)
    expect(queued.queued).toBe(true)
    const payload = (mutation.mock.calls as any[]).find((call) => String(call?.[1]?.action || "") === "deployCreds.update")?.[1]
    expect(payload).toEqual({
      projectId: "p1",
      action: "deployCreds.update",
      target: { doc: "<runtimeDir>/env" },
      data: { runId: "run_1", jobId: "job_1", targetRunnerId: "r1", updatedKeys: ["HCLOUD_TOKEN"] },
    })
  })

  it("updates only active key on keyring select", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        keys: [
          {
            key: "HCLOUD_TOKEN_KEYRING",
            source: "file",
            status: "set",
            value: '{"items":[{"id":"a","label":"A","value":"tok-a"},{"id":"b","label":"B","value":"tok-b"}]}',
          },
          {
            key: "HCLOUD_TOKEN_KEYRING_ACTIVE",
            source: "file",
            status: "set",
            value: "a",
          },
        ],
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(ctx, async () =>
      mod.queueProjectTokenKeyringUpdate({
        data: {
          projectId: "p1" as any,
          kind: "hcloud",
          action: "select",
          keyId: "b",
          targetRunnerId: "r1",
        },
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.updatedKeys).toEqual(["HCLOUD_TOKEN_KEYRING_ACTIVE"])
    const reservePayload = (mutation.mock.calls as any[])
      .map((call) => call?.[1])
      .find((payload) => Array.isArray(payload?.payloadMeta?.updatedKeys))
    expect(reservePayload?.payloadMeta?.updatedKeys).toEqual(["HCLOUD_TOKEN_KEYRING_ACTIVE"])
    expect(reservePayload?.payloadMeta?.args).toEqual([
      "env",
      "token-keyring-mutate",
      "--from-json",
      "__RUNNER_INPUT_JSON__",
      "--json",
    ])
    expect(reservePayload?.payloadMeta?.sealedInputKeys).toEqual(["action", "kind", "keyId", "label", "value"])
    const credentialPayload = (mutation.mock.calls as any[])
      .map((call) => call?.[1])
      .find((payload) => payload?.section === "hcloudKeyring")
    expect(credentialPayload).toMatchObject({
      projectId: "p1",
      section: "hcloudKeyring",
      syncStatus: "pending",
      sealedForRunnerId: "r1",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
    })
    expect(typeof credentialPayload?.sealedInputKeyId).toBe("string")
    expect(String(credentialPayload?.sealedInputKeyId || "").length).toBeGreaterThan(0)
    expect(typeof credentialPayload?.sealedValueB64).toBe("string")
  })

  it("rejects oversized key values before enqueue", async () => {
    const { mod, mutation } = await loadSdk({
      runnerJson: {
        keys: [],
      },
    })
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    await expect(runWithStartContext(ctx, async () =>
      mod.queueProjectTokenKeyringUpdate({
        data: {
          projectId: "p1" as any,
          kind: "hcloud",
          action: "add",
          label: "too-long",
          value: "x".repeat(PROJECT_TOKEN_VALUE_MAX_CHARS + 1),
          targetRunnerId: "r1",
        },
      }),
    )).rejects.toThrow(/value too long/i)
    expect(mutation).not.toHaveBeenCalled()
  })
})
