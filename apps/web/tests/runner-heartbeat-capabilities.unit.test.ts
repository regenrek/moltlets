import { describe, expect, it } from "vitest";
import { parseRunnerHeartbeatCapabilities } from "../convex/controlPlane/httpParsers";

describe("runner heartbeat capabilities", () => {
  it("accepts valid sealed-input capabilities", async () => {
    await expect(
      parseRunnerHeartbeatCapabilities({
        supportsSealedInput: true,
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputPubSpkiB64: "AQID",
        sealedInputKeyId: "A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc-4E",
        supportsInfraApply: true,
      }),
    ).resolves.toEqual({
      ok: true,
      capabilities: {
        supportsSealedInput: true,
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputPubSpkiB64: "AQID",
        sealedInputKeyId: "A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc-4E",
        supportsInfraApply: true,
      },
    });
  });

  it("rejects supportsSealedInput without required fields", async () => {
    await expect(parseRunnerHeartbeatCapabilities({ supportsSealedInput: true })).resolves.toEqual({
      ok: false,
      error: "invalid capabilities.supportsSealedInput",
    });
  });

  it("rejects invalid sealed-input key id", async () => {
    await expect(parseRunnerHeartbeatCapabilities({ sealedInputKeyId: "   " })).resolves.toEqual({
      ok: false,
      error: "invalid capabilities.sealedInputKeyId",
    });
  });

  it("rejects sealed-input key id mismatch against SPKI", async () => {
    await expect(
      parseRunnerHeartbeatCapabilities({
        supportsSealedInput: true,
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputPubSpkiB64: "AQID",
        sealedInputKeyId: "wrong",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "invalid capabilities.sealedInputKeyId",
    });
  });
});
