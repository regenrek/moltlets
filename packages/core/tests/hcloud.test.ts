import { describe, it, expect, vi, afterEach } from "vitest";
import { ensureHcloudSshKeyId, HCLOUD_REQUEST_TIMEOUT_MS } from "../src/lib/hcloud";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hcloud timeout", () => {
  it("aborts fetch when timeout elapses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<unknown>((_resolve, reject) => {
        const signal = opts?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        if (signal.aborted) {
          const err = new Error("aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const pending = ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey",
    });

    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(HCLOUD_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ensureHcloudSshKeyId", () => {
  const makeJsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("returns existing ssh key id from list", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        ssh_keys: [
          { id: 42, name: "key", public_key: "ssh-ed25519 AAA" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 AAA",
    });

    expect(id).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates key when missing", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ ssh_keys: [] }),
    );
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(
        makeJsonResponse({ ssh_key: { id: 7, name: "k", public_key: "ssh-ed25519 BBB" } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 BBB",
    });

    expect(id).toBe("7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries with alternate name on 409", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ ssh_keys: [] }),
    );
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(
        makeJsonResponse({ ssh_key: { id: 9, name: "k", public_key: "ssh-ed25519 CCC" } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 CCC",
    });

    expect(id).toBe("9");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to list after repeated 409", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ ssh_keys: [] }),
    );
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(
        makeJsonResponse({
          ssh_keys: [
            { id: 13, name: "k", public_key: "ssh-ed25519 DDD" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 DDD",
    });

    expect(id).toBe("13");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("surfaces list errors with body text", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawdlets",
        publicKey: "ssh-ed25519 EEE",
      }),
    ).rejects.toThrow(/HTTP 500: boom/);
  });
});
