import { describe, expect, it } from "vitest";
import { validateMetadataSyncPayloadSizes } from "../convex/controlPlane/httpParsers";

function sizedObjects(length: number): Record<string, never>[] {
  return Array.from({ length }, () => ({}));
}

describe("runner metadata sync payload limits", () => {
  it("accepts payloads within bounds", () => {
    expect(
      validateMetadataSyncPayloadSizes({
        projectConfigs: sizedObjects(10),
        hosts: sizedObjects(10),
        gateways: sizedObjects(10),
        secretWiring: sizedObjects(10),
      }),
    ).toBeNull();
  });

  it("rejects oversized payload arrays", () => {
    expect(
      validateMetadataSyncPayloadSizes({
        projectConfigs: sizedObjects(501),
        hosts: [],
        gateways: [],
        secretWiring: [],
      }),
    ).toBe("projectConfigs too large");
    expect(
      validateMetadataSyncPayloadSizes({
        projectConfigs: [],
        hosts: [],
        gateways: [],
        secretWiring: sizedObjects(2001),
      }),
    ).toBe("secretWiring too large");
  });
});
