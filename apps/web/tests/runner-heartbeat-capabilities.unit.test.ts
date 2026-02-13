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
        hasNix: true,
        nixBin: "/nix/var/nix/profiles/default/bin/nix",
        nixVersion: "nix (Nix) 2.24.9",
      }),
    ).resolves.toEqual({
      ok: true,
      capabilities: {
        supportsSealedInput: true,
        sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
        sealedInputPubSpkiB64: "AQID",
        sealedInputKeyId: "A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc-4E",
        supportsInfraApply: true,
        hasNix: true,
        nixBin: "/nix/var/nix/profiles/default/bin/nix",
        nixVersion: "nix (Nix) 2.24.9",
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

  it("rejects hasNix=true without nixVersion", async () => {
    await expect(
      parseRunnerHeartbeatCapabilities({
        hasNix: true,
        nixBin: "/nix/var/nix/profiles/default/bin/nix",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "invalid capabilities.hasNix",
    });
  });

  it("infers hasNix=true when nixVersion is present", async () => {
    await expect(
      parseRunnerHeartbeatCapabilities({
        nixVersion: "nix (Nix) 2.24.9",
      }),
    ).resolves.toMatchObject({
      ok: true,
      capabilities: {
        hasNix: true,
        nixVersion: "nix (Nix) 2.24.9",
      },
    });
  });

  it("rejects nix fields when hasNix is false", async () => {
    await expect(
      parseRunnerHeartbeatCapabilities({
        hasNix: false,
        nixVersion: "nix (Nix) 2.24.9",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "invalid capabilities.hasNix",
    });
  });
});
