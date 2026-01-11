import { describe, it, expect } from "vitest";
import { withFlakesEnv } from "../src/lib/nix-flakes";

describe("nix-flakes", () => {
  it("adds NIX_CONFIG when missing", () => {
    const out = withFlakesEnv({ PATH: "/bin" });
    expect(String(out.NIX_CONFIG || "")).toContain("experimental-features");
    expect(String(out.NIX_CONFIG || "")).toContain("nix-command");
    expect(String(out.NIX_CONFIG || "")).toContain("flakes");
  });

  it("keeps existing NIX_CONFIG if it already enables flakes", () => {
    const env = { NIX_CONFIG: "experimental-features = nix-command flakes\nfoo = bar" };
    const out = withFlakesEnv(env);
    expect(out.NIX_CONFIG).toBe(env.NIX_CONFIG);
  });

  it("appends flakes enablement when NIX_CONFIG is present but incomplete", () => {
    const env = { NIX_CONFIG: "sandbox = false" };
    const out = withFlakesEnv(env);
    expect(String(out.NIX_CONFIG || "")).toContain("sandbox = false");
    expect(String(out.NIX_CONFIG || "")).toContain("experimental-features = nix-command flakes");
  });
});

