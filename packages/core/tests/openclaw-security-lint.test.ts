import { describe, expect, it } from "vitest";

describe("openclaw security lint", () => {
  it("flags open Telegram DMs without wildcard allowFrom", async () => {
    const { lintOpenclawSecurityConfig } = await import("../src/lib/openclaw-security-lint");

    const res = lintOpenclawSecurityConfig({
      botId: "agent",
      openclaw: {
        channels: {
          telegram: {
            dmPolicy: "open",
            allowFrom: [],
          },
        },
      },
    });
    expect(res.summary.critical).toBe(2);
    expect(res.findings.map((f) => f.id)).toContain("channels.telegram.dmPolicy.open");
    expect(res.findings.map((f) => f.id)).toContain("channels.telegram.dmPolicy.open_missing_wildcard");
  });

  it("flags open group policy and wildcard groupAllowFrom", async () => {
    const { lintOpenclawSecurityConfig } = await import("../src/lib/openclaw-security-lint");

    const res = lintOpenclawSecurityConfig({
      openclaw: {
        channels: {
          whatsapp: {
            groupPolicy: "open",
            groupAllowFrom: ["*"],
          },
        },
      },
    });
    expect(res.summary.critical).toBe(2);
    expect(res.findings.map((f) => f.id)).toContain("channels.whatsapp.groupPolicy.open");
    expect(res.findings.map((f) => f.id)).toContain("channels.whatsapp.groupAllowFrom.wildcard");
  });

  it("warns when multi-user DM shares main session", async () => {
    const { lintOpenclawSecurityConfig } = await import("../src/lib/openclaw-security-lint");

    const res = lintOpenclawSecurityConfig({
      openclaw: {
        session: { dmScope: "main" },
        channels: {
          slack: {
            enabled: true,
            dm: { policy: "pairing", allowFrom: ["U1", "U2"] },
          },
        },
      },
    });
    expect(res.summary.warn).toBe(1);
    expect(res.findings[0]?.id).toBe("session.dmScope.multi_user_dm");
  });

  it("flags inline secrets in known token fields", async () => {
    const { lintOpenclawSecurityConfig } = await import("../src/lib/openclaw-security-lint");

    const res = lintOpenclawSecurityConfig({
      botId: "agent",
      openclaw: {
        gateway: { auth: { token: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
        hooks: { token: "not-an-env-ref" },
        skills: { entries: { "brave-search": { apiKey: "AIzaaaaaaaaaaaaaaaaaaaaa" } } },
      },
    });

    const ids = res.findings.map((f) => f.id);
    expect(ids).toContain("inlineSecret.gateway.auth.token");
    expect(ids).toContain("inlineSecret.hooks.token");
    expect(ids).toContain("inlineSecret.skills.entries.brave-search.apiKey");
    expect(res.summary.critical).toBe(3);
  });
});
