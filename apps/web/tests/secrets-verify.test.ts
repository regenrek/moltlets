import { describe, expect, it } from "vitest"
import { mapSecretsVerifyTerminalStatus } from "../src/sdk/secrets/verify"

describe("mapSecretsVerifyTerminalStatus", () => {
  it("maps succeeded terminal status", () => {
    expect(mapSecretsVerifyTerminalStatus("succeeded")).toBe("succeeded")
  })

  it("maps failed terminal status", () => {
    expect(mapSecretsVerifyTerminalStatus("failed")).toBe("failed")
  })

  it("maps canceled terminal status", () => {
    expect(mapSecretsVerifyTerminalStatus("canceled")).toBe("canceled")
  })

  it("maps queued terminal status to timed_out", () => {
    expect(mapSecretsVerifyTerminalStatus("queued")).toBe("timed_out")
  })

  it("maps running terminal status to timed_out", () => {
    expect(mapSecretsVerifyTerminalStatus("running")).toBe("timed_out")
  })
})
