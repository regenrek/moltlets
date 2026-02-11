import { describe, expect, it } from "vitest";
import { sanitizeRunEventMessage, RUN_EVENT_MESSAGE_MAX_CHARS } from "../src/lib/runtime/run-event-sanitize";

describe("run event sanitization", () => {
  it("trims, redacts, and preserves key separators", () => {
    const input = "  token: abc apiKey = xyz  ";
    expect(sanitizeRunEventMessage(input)).toEqual({ message: "token: <redacted> apiKey = <redacted>", redacted: true });
  });

  it("drops empty messages", () => {
    expect(sanitizeRunEventMessage("   ")).toEqual({ message: "", redacted: false });
  });

  it("clips to max length and preserves suffix ellipsis", () => {
    const input = "x".repeat(RUN_EVENT_MESSAGE_MAX_CHARS + 100);
    const out = sanitizeRunEventMessage(input);
    expect(out.message.length).toBe(RUN_EVENT_MESSAGE_MAX_CHARS);
    expect(out.message.endsWith("...")).toBe(true);
    expect(out.redacted).toBe(false);
  });
});
