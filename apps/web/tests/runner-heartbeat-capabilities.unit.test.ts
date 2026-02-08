import { describe, expect, it } from "vitest";
import { __test_parseRunnerHeartbeatCapabilities } from "../convex/http";

describe("runner heartbeat capabilities", () => {
  it("accepts a valid nonce and port", () => {
    expect(
      __test_parseRunnerHeartbeatCapabilities({
        supportsLocalSecretsSubmit: true,
        supportsInteractiveSecrets: false,
        supportsInfraApply: true,
        localSecretsPort: 43110,
        localSecretsNonce: " nonce-123 ",
      }),
    ).toEqual({
      ok: true,
      capabilities: {
        supportsLocalSecretsSubmit: true,
        supportsInteractiveSecrets: false,
        supportsInfraApply: true,
        localSecretsPort: 43110,
        localSecretsNonce: "nonce-123",
      },
    });
  });

  it("rejects blank nonce when provided", () => {
    expect(__test_parseRunnerHeartbeatCapabilities({ localSecretsNonce: "   " })).toEqual({
      ok: false,
      error: "invalid capabilities.localSecretsNonce",
    });
  });

  it("rejects oversized nonce", () => {
    expect(__test_parseRunnerHeartbeatCapabilities({ localSecretsNonce: "x".repeat(129) })).toEqual({
      ok: false,
      error: "invalid capabilities.localSecretsNonce",
    });
  });
});
