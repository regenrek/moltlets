import { describe, expect, it } from "vitest";
import { parseNixOpenclawSource, fetchNixOpenclawSourceInfo } from "../src/lib/nix-openclaw-source.js";

describe("parseNixOpenclawSource", () => {
  it("parses double-quoted attrs with comments", () => {
    const raw = `
      # pinned clawdbot
      {
        owner = "clawdbot";
        repo = "clawdbot";
        rev = "abc123";
        hash = "sha256-xyz";
        pnpmDepsHash = "sha256-abc";
      }
    `;
    const parsed = parseNixOpenclawSource(raw);
    expect(parsed).toEqual({ rev: "abc123", hash: "sha256-xyz", pnpmDepsHash: "sha256-abc" });
  });

  it("parses single-quoted attrs and strips block comments", () => {
    const raw = `
      /*
        comment with = and braces {}
      */
      {
        rev = 'deadbeef';
        hash = 'sha256-1';
        pnpmDepsHash = 'sha256-2';
      }
    `;
    const parsed = parseNixOpenclawSource(raw);
    expect(parsed).toEqual({ rev: "deadbeef", hash: "sha256-1", pnpmDepsHash: "sha256-2" });
  });

  it("returns null when rev is missing", () => {
    const raw = `{ hash = "sha256-x"; }`;
    const parsed = parseNixOpenclawSource(raw);
    expect(parsed).toBeNull();
  });
});

describe("fetchNixOpenclawSourceInfo", () => {
  it("rejects non-string refs without throwing", async () => {
    const res = await fetchNixOpenclawSourceInfo({ ref: undefined as unknown as string, timeoutMs: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid nix-openclaw ref");
    }
  });

  it("rejects invalid refs", async () => {
    const res = await fetchNixOpenclawSourceInfo({ ref: "main\nbad", timeoutMs: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("invalid nix-openclaw ref");
      expect(res.sourceUrl).toBe("");
    }
  });

  it("parses fetched nix source", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          text: async () => `{
            rev = "abc123";
            hash = "sha256-x";
            pnpmDepsHash = "sha256-y";
          }`,
        }) as Response;
      const res = await fetchNixOpenclawSourceInfo({ ref: "main", timeoutMs: 1000 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.info.rev).toBe("abc123");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to moltbot-source.nix when openclaw-source.nix is missing", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const urls: string[] = [];
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (urls.length === 1) {
          return { ok: false, status: 404, text: async () => "not found" } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => `{
            rev = "abc123";
            hash = "sha256-x";
            pnpmDepsHash = "sha256-y";
          }`,
        } as Response;
      };
      const res = await fetchNixOpenclawSourceInfo({ ref: "main", timeoutMs: 1000 });
      expect(res.ok).toBe(true);
      expect(urls[0]).toContain("/openclaw-source.nix");
      expect(urls[1]).toContain("/moltbot-source.nix");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles non-200 responses", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        ({
          ok: false,
          status: 429,
          text: async () => "rate limited",
        }) as Response;
      const res = await fetchNixOpenclawSourceInfo({ ref: "main", timeoutMs: 1000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("http 429");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
