import { describe, it, expect, vi, afterEach } from "vitest";
import { tryParseGithubFlakeUri, checkGithubRepoVisibility } from "../src/lib/github";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("github helpers", () => {
  it("parses github flake URIs", () => {
    expect(tryParseGithubFlakeUri("github:owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(tryParseGithubFlakeUri("gitlab:owner/repo")).toBeNull();
  });

  it("returns public on 200", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res).toEqual({ ok: true, status: "public" });
  });

  it("returns rate-limited on 403", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limit", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe("rate-limited");
      expect(res.detail).toBe("rate limit");
    }
  });

  it("returns unauthorized on 401", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res).toEqual({ ok: true, status: "unauthorized" });
  });

  it("returns private-or-missing on 404", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res).toEqual({ ok: true, status: "private-or-missing" });
  });

  it("returns network on unexpected status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("network");
      expect(res.detail).toContain("HTTP 500");
    }
  });

  it("returns network error on fetch failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkGithubRepoVisibility({ owner: "o", repo: "r" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("network");
      expect(res.detail).toContain("boom");
    }
  });
});
