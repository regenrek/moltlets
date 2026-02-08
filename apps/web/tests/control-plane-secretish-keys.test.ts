import { describe, expect, it } from "vitest";
import { assertNoSecretLikeKeys } from "../convex/shared/controlPlane";

describe("control-plane secret-like key guard", () => {
  it("rejects password/secret/apiKey/privateKey keys", () => {
    expect(() => assertNoSecretLikeKeys({ password: "x" }, "payload")).toThrow(/forbidden/i);
    expect(() => assertNoSecretLikeKeys({ secret: "x" }, "payload")).toThrow(/forbidden/i);
    expect(() => assertNoSecretLikeKeys({ apiKey: "x" }, "payload")).toThrow(/forbidden/i);
    expect(() => assertNoSecretLikeKeys({ privateKey: "x" }, "payload")).toThrow(/forbidden/i);
  });

  it("allows metadata-only payloads", () => {
    expect(() =>
      assertNoSecretLikeKeys(
        {
          payloadMeta: {
            hostName: "alpha",
            args: ["doctor"],
          },
        },
        "payload",
      ),
    ).not.toThrow();
  });
});
