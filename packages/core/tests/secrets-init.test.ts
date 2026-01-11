import { describe, it, expect } from "vitest";

describe("secrets-init JSON + non-interactive validation", () => {
  it("parseSecretsInitJson rejects invalid JSON without leaking content", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    expect(() => parseSecretsInitJson("{")).toThrow(/expected valid JSON/i);
  });

  it("parseSecretsInitJson rejects missing adminPasswordHash without leaking tokens", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    const secret = "SUPER_SECRET_TOKEN_123";
    const raw = JSON.stringify({ discordTokens: { maren: secret } });
    try {
      parseSecretsInitJson(raw);
      throw new Error("expected parseSecretsInitJson to throw");
    } catch (e: any) {
      const msg = String(e?.message || "");
      expect(msg).toMatch(/missing adminPasswordHash/i);
      expect(msg).not.toContain(secret);
    }
  });

  it("parseSecretsInitJson trims fields and ignores empty tokens", async () => {
    const { parseSecretsInitJson } = await import("../src/lib/secrets-init");
    const out = parseSecretsInitJson(
      JSON.stringify({
        adminPasswordHash: "  hash  ",
        tailscaleAuthKey: "  ts  ",
        zAiApiKey: "  zai  ",
        discordTokens: { maren: "  tok  ", sonja: " " },
      }),
    );
    expect(out.adminPasswordHash).toBe("hash");
    expect(out.tailscaleAuthKey).toBe("ts");
    expect(out.zAiApiKey).toBe("zai");
    expect(out.discordTokens).toEqual({ maren: "tok" });
  });

  it("validateSecretsInitNonInteractive requires --from-json", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: undefined,
        yes: false,
        dryRun: false,
        localSecretsDirExists: false,
      }),
    ).toThrow(/requires --from-json/i);
  });

  it("validateSecretsInitNonInteractive blocks overwrite without --yes", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: "-",
        yes: false,
        dryRun: false,
        localSecretsDirExists: true,
      }),
    ).toThrow(/refusing to overwrite/i);
  });

  it("validateSecretsInitNonInteractive allows overwrite with --yes", async () => {
    const { validateSecretsInitNonInteractive } = await import("../src/lib/secrets-init");
    expect(() =>
      validateSecretsInitNonInteractive({
        interactive: false,
        fromJson: "-",
        yes: true,
        dryRun: false,
        localSecretsDirExists: true,
      }),
    ).not.toThrow();
  });
});
