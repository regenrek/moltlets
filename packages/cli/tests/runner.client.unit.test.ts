import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRunnerHttpError, RunnerApiClient, RunnerHttpError } from "../src/commands/runner/client.js";

describe("runner api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("sends local secrets nonce in heartbeat capabilities", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        capabilities?: { localSecretsNonce?: string };
      };
      expect(body.capabilities?.localSecretsNonce).toBe("nonce-123");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new RunnerApiClient("http://127.0.0.1:3000", "token");
    await expect(
      client.heartbeat({
        projectId: "p1",
        runnerName: "runner-a",
        capabilities: {
          supportsLocalSecretsSubmit: true,
          localSecretsPort: 43110,
          localSecretsNonce: "nonce-123",
        },
      }),
    ).resolves.toEqual({});
  });
});
