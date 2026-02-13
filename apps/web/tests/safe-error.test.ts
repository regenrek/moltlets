import { describe, expect, it } from "vitest"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"

describe("sanitizeErrorMessage", () => {
  it("returns safe message when matched", () => {
    expect(sanitizeErrorMessage(new Error("Admin required"), "fallback")).toBe("Admin required")
    expect(sanitizeErrorMessage("Too many requests", "fallback")).toBe("Too many requests")
    expect(sanitizeErrorMessage(new Error("run canceled"), "fallback")).toBe("run canceled")
    expect(sanitizeErrorMessage(new Error("run timed out after 45s"), "fallback")).toBe("run timed out after 45s")
    expect(sanitizeErrorMessage(new Error("nix exited with code 1"), "fallback")).toBe("nix exited with code 1")
    expect(sanitizeErrorMessage(new Error("spawn nix ENOENT"), "fallback")).toBe("spawn nix ENOENT")
  })

  it("prefers safe err.message when data.message is unsafe", () => {
    const err = Object.assign(new Error("Missing origin remote."), { data: { message: "/etc/passwd" } })
    expect(sanitizeErrorMessage(err, "fallback")).toBe("Missing origin remote.")
  })

  it("uses data.message when safe", () => {
    const err = { data: { message: "Unknown branch." } }
    expect(sanitizeErrorMessage(err, "fallback")).toBe("Unknown branch.")
  })

  it("falls back on unsafe messages", () => {
    expect(sanitizeErrorMessage(new Error("permission denied: /etc/hosts"), "fallback")).toBe("fallback")
  })
})
