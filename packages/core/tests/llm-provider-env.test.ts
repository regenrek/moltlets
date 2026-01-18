import { describe, it, expect } from "vitest";

describe("llm provider env", () => {
  it("parses provider from provider/model ids", async () => {
    const { getLlmProviderFromModelId } = await import("../src/lib/llm-provider-env");
    expect(getLlmProviderFromModelId("")).toBe(null);
    expect(getLlmProviderFromModelId("glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("/glm-4.7")).toBe(null);
    expect(getLlmProviderFromModelId("ZAI/glm-4.7")).toBe("zai");
  });

  it("returns required env vars for known providers and empty for unknown", async () => {
    const { getProviderRequiredEnvVars, getModelRequiredEnvVars } = await import("../src/lib/llm-provider-env");
    expect(getProviderRequiredEnvVars("unknown")).toEqual([]);
    expect(getProviderRequiredEnvVars("openai")).toEqual(["OPENAI_API_KEY", "OPEN_AI_APIKEY"]);
    expect(getModelRequiredEnvVars("anthropic/claude")).toEqual(["ANTHROPIC_API_KEY"]);
    expect(getModelRequiredEnvVars("nope")).toEqual([]);
  });

});
