import { describe, expect, it } from "vitest";
import { validateMetadataSyncPayloadSizes } from "../convex/controlPlane/httpParsers";

describe("runner metadata sync payload limits", () => {
  it("accepts payloads within bounds", () => {
    expect(
      validateMetadataSyncPayloadSizes({
        projectConfigs: new Array(10).fill({}),
        hosts: new Array(10).fill({}),
        gateways: new Array(10).fill({}),
        secretWiring: new Array(10).fill({}),
      }),
    ).toBeNull();
  });

  it("rejects oversized payload arrays", () => {
    expect(
      validateMetadataSyncPayloadSizes({
        projectConfigs: new Array(501).fill({}),
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
        secretWiring: new Array(2001).fill({}),
      }),
    ).toBe("secretWiring too large");
  });
});
