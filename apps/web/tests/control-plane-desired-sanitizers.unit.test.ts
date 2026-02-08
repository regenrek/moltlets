import { describe, expect, it } from "vitest";
import { sanitizeHostPatch, sanitizeGatewayPatch } from "../convex/controlPlane/httpParsers";
import { sanitizeHostPatchInput } from "../convex/controlPlane/hosts";
import { sanitizeGatewayPatchInput } from "../convex/controlPlane/gateways";

describe("control-plane desired sanitizers", () => {
  it("keeps host desired output identical across HTTP and mutation paths", () => {
    const patch = {
      provider: "provider-a",
      region: "us-west",
      lastSeenAt: 123.9,
      lastStatus: "online",
      lastRunStatus: "running",
      desired: {
        gatewayCount: 15_000,
        selfUpdateBaseUrlCount: 20_000,
        selfUpdatePublicKeyCount: -5,
        targetHost: "example.com",
        selfUpdateEnabled: true,
      },
    };

    const httpOut = sanitizeHostPatch(patch);
    const mutationOut = sanitizeHostPatchInput(patch as any);
    expect(httpOut).toEqual(mutationOut);
    expect((httpOut.desired as any)?.gatewayCount).toBe(10_000);
    expect((httpOut.desired as any)?.selfUpdateBaseUrlCount).toBe(10_000);
    expect((httpOut.desired as any)?.selfUpdatePublicKeyCount).toBe(0);
  });

  it("keeps gateway desired output identical across HTTP and mutation paths", () => {
    const entries = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const patch = {
      lastSeenAt: 456.3,
      lastStatus: "degraded",
      desired: {
        enabled: true,
        channelCount: 12_345,
        personaCount: -3,
        provider: "provider-b",
        channels: entries,
        personaIds: entries,
        port: 70_000,
      },
    };

    const httpOut = sanitizeGatewayPatch(patch);
    const mutationOut = sanitizeGatewayPatchInput(patch as any);
    expect(httpOut).toEqual(mutationOut);
    expect((httpOut.desired as any)?.channels).toHaveLength(256);
    expect((httpOut.desired as any)?.personaIds).toHaveLength(256);
    expect((httpOut.desired as any)?.channelCount).toBe(10_000);
    expect((httpOut.desired as any)?.personaCount).toBe(0);
    expect((httpOut.desired as any)?.port).toBe(65_535);
  });
});
