import { describe, expect, it } from "vitest"
import {
  deriveRunnerConnectionToastKind,
  RUNNER_CONNECTING_TOAST_DELAY_MS,
  RUNNER_CONNECTION_TOAST_MESSAGES,
} from "../src/lib/setup/runner-connection-toast"

describe("deriveRunnerConnectionToastKind", () => {
  it("does not emit on initial state", () => {
    expect(deriveRunnerConnectionToastKind({ previous: null, next: "offline" })).toBe(null)
    expect(deriveRunnerConnectionToastKind({ previous: null, next: "connecting" })).toBe(null)
    expect(deriveRunnerConnectionToastKind({ previous: null, next: "ready" })).toBe(null)
  })

  it("does not emit when state is unchanged", () => {
    expect(deriveRunnerConnectionToastKind({ previous: "offline", next: "offline" })).toBe(null)
    expect(deriveRunnerConnectionToastKind({ previous: "connecting", next: "connecting" })).toBe(null)
    expect(deriveRunnerConnectionToastKind({ previous: "ready", next: "ready" })).toBe(null)
  })

  it("emits transition toast kind", () => {
    expect(deriveRunnerConnectionToastKind({ previous: "offline", next: "connecting" })).toBe("connecting")
    expect(deriveRunnerConnectionToastKind({ previous: "connecting", next: "ready" })).toBe("ready")
    expect(deriveRunnerConnectionToastKind({ previous: "ready", next: "offline" })).toBe("offline")
  })

  it("exports non-empty copy and positive delay", () => {
    expect(RUNNER_CONNECTING_TOAST_DELAY_MS).toBeGreaterThan(0)
    expect(RUNNER_CONNECTION_TOAST_MESSAGES.connecting.length).toBeGreaterThan(0)
    expect(RUNNER_CONNECTION_TOAST_MESSAGES.ready.length).toBeGreaterThan(0)
    expect(RUNNER_CONNECTION_TOAST_MESSAGES.offline.length).toBeGreaterThan(0)
  })
})
