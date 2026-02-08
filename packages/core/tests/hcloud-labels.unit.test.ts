import { describe, it, expect } from "vitest";

describe("hcloud-labels", () => {
  it("validates label keys/values", async () => {
    const { isValidHcloudLabelKey, isValidHcloudLabelValue } = await import("../src/lib/config/hcloud-labels.js");

    expect(isValidHcloudLabelKey("managed-by")).toBe(true);
    expect(isValidHcloudLabelKey("a/b")).toBe(true);
    expect(isValidHcloudLabelKey("bad key")).toBe(false);

    expect(isValidHcloudLabelValue("clawlets")).toBe(true);
    expect(isValidHcloudLabelValue("")).toBe(true);
    expect(isValidHcloudLabelValue("-bad")).toBe(false);
    expect(isValidHcloudLabelValue("bad ")).toBe(false);
  });

  it("slugs unsafe values deterministically", async () => {
    const { toHcloudLabelValueSlug } = await import("../src/lib/config/hcloud-labels.js");
    expect(toHcloudLabelValueSlug("Hello World", { fallback: "x" })).toBe("hello-world");
    expect(toHcloudLabelValueSlug("////", { fallback: "x" })).toBe("x");
  });
});
