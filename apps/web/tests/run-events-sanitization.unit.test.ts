import { describe, expect, it } from "vitest"
import { redactKnownSecrets } from "@clawlets/core/lib/runtime/redaction"
import { sanitizeRunEventMessage, RUN_EVENT_MESSAGE_MAX_CHARS } from "@clawlets/core/lib/runtime/run-event-sanitize"

describe("control-plane run event sanitization", () => {
  it("matches shared redaction output and marks redacted=true", () => {
    const input =
      "Authorization: Bearer tok_123 token: abc123 https://user:pass@github.com/org/repo.git"
    const shared = redactKnownSecrets(input)
    const sanitized = sanitizeRunEventMessage(input)
    expect(sanitized).toEqual({ message: shared.text, redacted: shared.redacted })
  })

  it("drops empty/whitespace-only messages", () => {
    expect(sanitizeRunEventMessage("   ")).toEqual({ message: "", redacted: false })
  })

  it("clips event messages to storage max length", () => {
    const input = "x".repeat(5000)
    const sanitized = sanitizeRunEventMessage(input)
    expect(sanitized.message.length).toBe(RUN_EVENT_MESSAGE_MAX_CHARS)
    expect(sanitized.message.endsWith("...")).toBe(true)
  })
})
