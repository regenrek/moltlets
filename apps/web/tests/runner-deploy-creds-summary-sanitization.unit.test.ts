import { describe, expect, it } from "vitest";
import { sanitizeDeployCredsSummary } from "../convex/controlPlane/httpParsers";

describe("runner deploy-creds summary sanitization", () => {
  it("returns null for invalid root payloads", () => {
    expect(sanitizeDeployCredsSummary(null)).toBeNull();
    expect(sanitizeDeployCredsSummary([])).toBeNull();
    expect(sanitizeDeployCredsSummary({ updatedAtMs: "nope" })).toBeNull();
  });

  it("normalizes defaults and clamps keyring counts", () => {
    const out = sanitizeDeployCredsSummary({
      updatedAtMs: 1234.9,
      envFileOrigin: "other",
      envFileStatus: "other",
      envFileError: "env read failed",
      hasGithubToken: 1,
      sopsAgeKeyFileSet: "",
      projectTokenKeyrings: {
        hcloud: { hasActive: "yes", itemCount: 20_000 },
        tailscale: { hasActive: 0, itemCount: -10 },
      },
    });
    expect(out).toEqual({
      updatedAtMs: 1234,
      envFileOrigin: "default",
      envFileStatus: "missing",
      envFileError: "env read failed",
      hasGithubToken: true,
      sopsAgeKeyFileSet: false,
      projectTokenKeyrings: {
        hcloud: { hasActive: true, itemCount: 10_000 },
        tailscale: { hasActive: false, itemCount: 0 },
      },
    });
  });

  it("accepts valid typed payloads without mutation", () => {
    const input = {
      updatedAtMs: 9_999,
      envFileOrigin: "explicit",
      envFileStatus: "ok",
      hasGithubToken: true,
      sopsAgeKeyFileSet: true,
      projectTokenKeyrings: {
        hcloud: { hasActive: true, itemCount: 2 },
        tailscale: { hasActive: false, itemCount: 1 },
      },
    };
    expect(sanitizeDeployCredsSummary(input)).toEqual(input);
  });
});
