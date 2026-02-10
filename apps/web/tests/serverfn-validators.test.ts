import { describe, expect, it } from "vitest"

import {
  parseGatewayCapabilityPresetInput,
  parseGatewayOpenclawConfigInput,
  parseProjectSshKeysInput,
  parseProjectIdInput,
  parseProjectGatewayInput,
  parseProjectHostInput,
  parseProjectHostScopeInput,
  parseProjectHostRequiredInput,
  parseProjectRunHostInput,
  parseProjectRunHostConfirmInput,
  parseProjectRunHostScopeInput,
  parseProjectHostTargetInput,
  parseServerAuditExecuteInput,
  parseServerAuditStartInput,
  parseServerChannelsExecuteInput,
  parseServerChannelsStartInput,
  parseServerStatusStartInput,
  parseServerStatusExecuteInput,
  parseServerLogsStartInput,
  parseServerLogsExecuteInput,
  parseServerRestartExecuteInput,
  parseServerRestartStartInput,
  parseServerUpdateApplyStartInput,
  parseServerUpdateStatusExecuteInput,
  parseServerUpdateLogsStartInput,
  parseServerUpdateLogsExecuteInput,
  parseServerUpdateStatusStartInput,
  parseSecretsInitExecuteInput,
  parseWriteHostSecretsFinalizeInput,
  parseWriteHostSecretsInput,
} from "~/sdk/runtime"

describe("serverfn validators", () => {
  it("accepts allowed server channels ops", () => {
    expect(
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
      }),
    ).toMatchObject({ host: "alpha", gatewayId: "maren", op: "status" })

    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "capabilities",
        timeout: "15000",
        json: true,
      }),
    ).toMatchObject({ op: "capabilities", timeoutMs: 15000, json: true })
  })

  it("rejects non-allowlisted server channels ops", () => {
    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        gatewayId: "maren",
        op: "rm",
      }),
    ).toThrow()
  })

  it("rejects invalid host/gateway ids", () => {
    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "ALPHA",
        gatewayId: "maren",
        op: "status",
      }),
    ).toThrow()

    expect(() =>
      parseServerChannelsStartInput({
        projectId: "p1",
        host: "alpha",
        gatewayId: "Maren",
        op: "status",
      }),
    ).toThrow()
  })

  it("parses timeouts and validates bounds", () => {
    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
        timeout: "",
      }),
    ).toMatchObject({ timeoutMs: 10000 })

    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
        timeout: "999",
      }),
    ).toThrow(/invalid timeout/i)

    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
        timeout: "121000",
      }),
    ).toThrow(/invalid timeout/i)
  })

  it("rejects overlong optional args", () => {
    const longChannel = "a".repeat(65)
    expect(() =>
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
        channel: longChannel,
      }),
    ).toThrow(/invalid input/i)
  })

  it("defaults non-string optional args to empty", () => {
    expect(
      parseServerChannelsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        gatewayId: "maren",
        op: "status",
        channel: 123,
        account: null,
        target: false,
      } as any),
    ).toMatchObject({ channel: "", account: "", target: "" })
  })

  it("parses project+host inputs", () => {
    expect(parseProjectHostInput({ projectId: "p1", host: "alpha" })).toEqual({ projectId: "p1", host: "alpha" })
    expect(parseProjectHostInput({ projectId: "p1", host: "" })).toEqual({ projectId: "p1", host: "" })
  })

  it("parses scoped project+host inputs", () => {
    expect(parseProjectHostScopeInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
      scope: "all",
    })
    expect(parseProjectHostScopeInput({ projectId: "p1", host: "alpha", scope: " bootstrap " })).toEqual({
      projectId: "p1",
      host: "alpha",
      scope: "bootstrap",
    })
    expect(() => parseProjectHostScopeInput({ projectId: "p1", host: "alpha", scope: "nope" })).toThrow(/invalid scope/i)
  })

  it("rejects invalid project ids", () => {
    expect(() => parseProjectIdInput({ projectId: "" })).toThrow()
    expect(() => parseProjectIdInput({ projectId: 123 })).toThrow()
    expect(() => parseProjectIdInput({})).toThrow()
    expect(() => parseProjectIdInput([] as any)).toThrow()
  })

  it("rejects invalid project ids for gateway inputs", () => {
    expect(() => parseProjectGatewayInput({ projectId: "", host: "alpha", gatewayId: "maren" })).toThrow()
    expect(() => parseGatewayOpenclawConfigInput({ projectId: "", host: "alpha", gatewayId: "maren", openclaw: {} })).toThrow()
  })

  it("trims gatewayId and validates schemaMode", () => {
    expect(
      parseGatewayOpenclawConfigInput({
        projectId: "p1",
        gatewayId: " maren ",
        host: "alpha",
        schemaMode: "live",
        openclaw: {},
      }),
    ).toMatchObject({ gatewayId: "maren", schemaMode: "live" })

    expect(() =>
      parseGatewayOpenclawConfigInput({
        projectId: "p1",
        gatewayId: "maren",
        host: "alpha",
        schemaMode: "fast",
        openclaw: {},
      }),
    ).toThrow(/invalid schemamode/i)
  })

  it("requires host when configured", () => {
    expect(parseProjectHostRequiredInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })
    expect(() => parseProjectHostRequiredInput({ projectId: "p1", host: "" })).toThrow()
  })

  it("parses project+run+host inputs", () => {
    expect(parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "alpha" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
    })
    expect(() => parseProjectRunHostInput({ projectId: "p1", runId: "r1", host: "" })).toThrow()
  })

  it("parses scoped project+run+host inputs", () => {
    expect(parseProjectRunHostScopeInput({ projectId: "p1", runId: "r1", host: "alpha" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      scope: "all",
    })
    expect(parseProjectRunHostScopeInput({ projectId: "p1", runId: "r1", host: "alpha", scope: "openclaw" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      scope: "openclaw",
    })
  })

  it("parses server logs lines and validates digits", () => {
    expect(
      parseServerLogsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        unit: "",
        lines: "",
      }),
    ).toMatchObject({ lines: "200" })

    expect(() =>
      parseServerLogsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        lines: "12x",
      }),
    ).toThrow(/invalid lines/i)
  })

  it("parses host/confirm/status/audit/log start validators", () => {
    expect(parseProjectHostTargetInput({ projectId: "p1", host: "alpha", targetHost: "admin@1.2.3.4" })).toEqual({
      projectId: "p1",
      host: "alpha",
      targetHost: "admin@1.2.3.4",
    })
    expect(parseProjectRunHostConfirmInput({ projectId: "p1", runId: "r1", host: "alpha", confirm: "yes" })).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      confirm: "yes",
    })
    expect(parseServerStatusStartInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })
    expect(
      parseServerStatusExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        targetHost: "admin@1.2.3.4",
      }),
    ).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      targetHost: "admin@1.2.3.4",
    })
    expect(parseServerAuditStartInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })
    expect(
      parseServerAuditExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        targetHost: "",
      }),
    ).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      targetHost: "",
    })
    expect(parseServerLogsStartInput({ projectId: "p1", host: "alpha", unit: "openclaw.service" })).toEqual({
      projectId: "p1",
      host: "alpha",
      unit: "openclaw.service",
    })
  })

  it("parses secrets init inputs with secret names only", () => {
    expect(
      parseSecretsInitExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        scope: "updates",
        allowPlaceholders: true,
        targetRunnerId: "rr1",
        secretNames: ["discord_token"],
      }),
    ).toMatchObject({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      scope: "updates",
      allowPlaceholders: true,
      targetRunnerId: "rr1",
      secretNames: ["discord_token"],
    })
  })

  it("rejects invalid writeHostSecrets input", () => {
    expect(() =>
      parseWriteHostSecretsInput({
        projectId: "p1",
        host: "alpha",
        secretNames: [],
        targetRunnerId: "",
        sealedInputB64: "",
        sealedInputAlg: "",
        sealedInputKeyId: "",
      }),
    ).toThrow()
  })

  it("parses writeHostSecrets with safe secret names", () => {
    expect(
      parseWriteHostSecretsInput({
        projectId: "p1",
        host: "alpha",
        secretNames: ["discord_token"],
        targetRunnerId: "rr1",
      }),
    ).toEqual({
      projectId: "p1",
      host: "alpha",
      secretNames: ["discord_token"],
      targetRunnerId: "rr1",
    })
  })

  it("parses writeHostSecrets finalize with sealed fields", () => {
    expect(
      parseWriteHostSecretsFinalizeInput({
        projectId: "p1",
        host: "alpha",
        jobId: "job1",
        kind: "secrets_write",
        secretNames: ["discord_token"],
        targetRunnerId: "rr1",
        sealedInputB64: "ciphertext",
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputKeyId: "kid123",
      }),
    ).toEqual({
      projectId: "p1",
      host: "alpha",
      jobId: "job1",
      kind: "secrets_write",
      secretNames: ["discord_token"],
      targetRunnerId: "rr1",
      sealedInputB64: "ciphertext",
      sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
      sealedInputKeyId: "kid123",
    })
  })

  it("parses server restart inputs", () => {
    expect(parseServerRestartStartInput({ projectId: "p1", host: "alpha", unit: "openclaw-*.service" })).toEqual({
      projectId: "p1",
      host: "alpha",
      unit: "openclaw-*.service",
    })

    expect(
      parseServerRestartExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        unit: "openclaw-agent.service",
        targetHost: "",
        confirm: "restart openclaw-agent.service",
      }),
    ).toMatchObject({ unit: "openclaw-agent.service", confirm: "restart openclaw-agent.service" })
  })

  it("parses server update status/logs inputs", () => {
    expect(parseServerUpdateStatusStartInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })

    expect(
      parseServerUpdateStatusExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        targetHost: "admin@1.2.3.4",
      }),
    ).toEqual({
      projectId: "p1",
      runId: "r1",
      host: "alpha",
      targetHost: "admin@1.2.3.4",
    })

    expect(parseServerUpdateLogsStartInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })

    expect(
      parseServerUpdateLogsExecuteInput({
        projectId: "p1",
        runId: "r1",
        host: "alpha",
        lines: "",
        since: "",
      }),
    ).toMatchObject({ lines: "200", since: "", follow: false })

    expect(parseServerUpdateApplyStartInput({ projectId: "p1", host: "alpha" })).toEqual({
      projectId: "p1",
      host: "alpha",
    })
  })

  it("rejects ssh key import file paths", () => {
    expect(() =>
      parseProjectSshKeysInput({
        projectId: "p1",
        keyText: "",
        knownHostsText: "",
        keyFilePath: "/etc/passwd",
      }),
    ).toThrow(/file path imports/i)
  })

  it("parses ssh key import text inputs", () => {
    expect(
      parseProjectSshKeysInput({
        projectId: "p1",
        keyText: "ssh-ed25519 AAAA",
        knownHostsText: "github.com ssh-ed25519 AAAA",
      }),
    ).toEqual({
      projectId: "p1",
      keyText: "ssh-ed25519 AAAA",
      knownHostsText: "github.com ssh-ed25519 AAAA",
    })
  })

  it("parses gateway capability preset inputs", () => {
    expect(
      parseGatewayCapabilityPresetInput({
        projectId: "p1",
        host: "alpha",
        gatewayId: "maren",
        kind: "channel",
        presetId: "discord",
        schemaMode: "live",
      }),
    ).toMatchObject({ gatewayId: "maren", kind: "channel", presetId: "discord", schemaMode: "live" })

    expect(() =>
      parseGatewayCapabilityPresetInput({
        projectId: "p1",
        host: "alpha",
        gatewayId: "maren",
        kind: "channel",
        presetId: "",
      }),
    ).toThrow(/presetId/i)
  })
})
