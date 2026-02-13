import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRunnerHttpError, RunnerApiClient, RunnerHttpError } from "../src/commands/runner/client.js";

describe("runner api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires control-plane url and runner token", () => {
    expect(() => new RunnerApiClient("", "token")).toThrow(/control plane url required/i);
    expect(() => new RunnerApiClient("http://127.0.0.1:3000", "")).toThrow(/runner token required/i);
  });

  it("classifies auth failures from http status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })),
    );
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toBeInstanceOf(RunnerHttpError);
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects malformed JSON on http 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: "malformed" });
  });

  it("classifies timeout/abort as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token", 10);
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: "transient" });
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toSatisfy((err: unknown) => {
      return classifyRunnerHttpError(err) === "transient";
    });
  });

  it("classifies key http statuses", async () => {
    const cases = [
      { status: 401, kind: "auth" },
      { status: 404, kind: "permanent" },
      { status: 429, kind: "transient" },
      { status: 500, kind: "transient" },
    ] as const;
    for (const row of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: `http ${row.status}` }), { status: row.status })),
      );
      const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
      await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: row.kind });
      vi.unstubAllGlobals();
    }
  });

  it("treats non-abort network errors as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket closed");
      }),
    );
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: "transient" });
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toSatisfy((err: unknown) => {
      return String((err as Error).message || "").includes("network error");
    });
  });

  it("accepts empty successful JSON bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(
      client.completeJob({
        projectId: "p1",
        jobId: "job-1",
        leaseId: "lease-1",
        status: "succeeded",
      } as any),
    ).resolves.toEqual({});
  });

  it("rejects array JSON responses as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(client.leaseNext({ projectId: "p1" as any })).rejects.toMatchObject({ kind: "malformed" });
  });

  it("sends sealed-input key id in heartbeat capabilities", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        capabilities?: { sealedInputKeyId?: string };
      };
      expect(body.capabilities?.sealedInputKeyId).toBe("kid-123");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(
      client.heartbeat({
        projectId: "p1",
        runnerName: "runner-a",
        capabilities: {
          supportsSealedInput: true,
          sealedInputAlg: "rsa-oaep-3072/aes-256-gcm",
          sealedInputPubSpkiB64: "abc123",
          sealedInputKeyId: "kid-123",
        },
      }),
    ).resolves.toEqual({});
  });

  it("syncMetadata sends only canonical payload fields", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      expect(body).toEqual({
        projectId: "p1",
        projectConfigs: [{ path: "fleet/clawlets.json", type: "fleet", sha256: "abc" }],
        hosts: [{ hostName: "alpha", patch: { provider: "hetzner" } }],
        gateways: [{ hostName: "alpha", gatewayId: "gw1", patch: { desired: { enabled: true } } }],
        secretWiring: [{ hostName: "alpha", secretName: "DISCORD_TOKEN", scope: "openclaw", status: "configured", required: true }],
      });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(
      client.syncMetadata({
        projectId: "p1",
        payload: {
          projectConfigs: [{ path: "fleet/clawlets.json", type: "fleet", sha256: "abc" }],
          hosts: [{ hostName: "alpha", patch: { provider: "hetzner" } }],
          gateways: [{ hostName: "alpha", gatewayId: "gw1", patch: { desired: { enabled: true } } }],
          secretWiring: [{ hostName: "alpha", secretName: "DISCORD_TOKEN", scope: "openclaw", status: "configured", required: true }],
        } as any,
      }),
    ).resolves.toEqual({});
  });
});
