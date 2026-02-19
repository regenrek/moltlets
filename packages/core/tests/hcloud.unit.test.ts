import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ensureHcloudSshKeyId,
  ensureHcloudFirewallId,
  listHcloudServers,
  createHcloudServer,
  getHcloudServer,
  waitForHcloudServerStatus,
  deleteHcloudServer,
  HCLOUD_REQUEST_TIMEOUT_MS,
} from "../src/lib/infra/providers/hetzner/hcloud.js";
import { makeEd25519PublicKey } from "./helpers/ssh-keys";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hcloud timeout", () => {
  it("aborts fetch when timeout elapses", async () => {
    vi.useFakeTimers();
    const key = makeEd25519PublicKey({ seedByte: 99 });

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
      name: "clawlets",
      publicKey: key,
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
    const key = makeEd25519PublicKey({ seedByte: 2 });
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        ssh_keys: [
          { id: 42, name: "key", public_key: key },
        ],
        meta: { pagination: { next_page: null } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: key,
    });

    expect(id).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("matches existing ssh key by key material (ignores comment)", async () => {
    const keyNoComment = makeEd25519PublicKey({ seedByte: 3 });
    const keyWithComment = `${keyNoComment} existing-comment`;
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        ssh_keys: [
          { id: 42, name: "key", public_key: keyWithComment },
        ],
        meta: { pagination: { next_page: null } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: `${keyNoComment} user@laptop`,
    });

    expect(id).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("paginates ssh key list", async () => {
    const k1 = makeEd25519PublicKey({ seedByte: 4 });
    const k2 = makeEd25519PublicKey({ seedByte: 5 });
    const fetchMock = vi.fn(async () => makeJsonResponse({ ssh_keys: [] }));
    fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse({
          ssh_keys: [{ id: 1, name: "k1", public_key: k1 }],
          meta: { pagination: { next_page: 2 } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          ssh_keys: [{ id: 2, name: "k2", public_key: k2 }],
          meta: { pagination: { next_page: null } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: k2,
    });

    expect(id).toBe("2");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url1 = new URL(String(fetchMock.mock.calls[0]?.[0] || ""));
    expect(url1.searchParams.get("page")).toBe("1");
    expect(url1.searchParams.get("per_page")).toBe("50");
    const url2 = new URL(String(fetchMock.mock.calls[1]?.[0] || ""));
    expect(url2.searchParams.get("page")).toBe("2");
    expect(url2.searchParams.get("per_page")).toBe("50");
  });

  it("fails fast on pagination loops", async () => {
    const key = makeEd25519PublicKey({ seedByte: 14 });
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        ssh_keys: [],
        meta: { pagination: { next_page: 1 } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: key,
      }),
    ).rejects.toThrow(/pagination loop detected/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores unparseable ssh key list entries", async () => {
    const key = makeEd25519PublicKey({ seedByte: 13 });
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        ssh_keys: [
          { id: 1, name: "bad", public_key: "ssh-ed25519 NOT_BASE64 comment" },
          { id: 2, name: "good", public_key: `${key} existing-comment` },
        ],
        meta: { pagination: { next_page: null } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: key,
    });

    expect(id).toBe("2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid ssh public keys before calling hcloud", async () => {
    const fetchMock = vi.fn(async () => makeJsonResponse({ ssh_keys: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: "ssh-ed25519 NOT_BASE64",
      }),
    ).rejects.toThrow(/invalid ssh public key/i);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("creates key when missing", async () => {
    const key = makeEd25519PublicKey({ seedByte: 6 });
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ ssh_keys: [] }),
    );
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(
        makeJsonResponse({ ssh_key: { id: 7, name: "k", public_key: key } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: key,
    });

    expect(id).toBe("7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries with alternate name on 409", async () => {
    const key = makeEd25519PublicKey({ seedByte: 7 });
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({ ssh_keys: [] }),
    );
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(
        makeJsonResponse({ ssh_key: { id: 9, name: "k", public_key: key } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: key,
    });

    expect(id).toBe("9");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to list after repeated 409", async () => {
    const key = makeEd25519PublicKey({ seedByte: 8 });
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
            { id: 13, name: "k", public_key: key },
          ],
          meta: { pagination: { next_page: null } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudSshKeyId({
      token: "token",
      name: "clawlets",
      publicKey: key,
    });

    expect(id).toBe("13");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("surfaces list errors with body text", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const key = makeEd25519PublicKey({ seedByte: 9 });
    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: key,
      }),
    ).rejects.toThrow(/HTTP 500: boom/);
  });

  it("truncates oversized error bodies", async () => {
    const huge = "x".repeat(70_000);
    const fetchMock = vi.fn(async () => new Response(huge, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const key = makeEd25519PublicKey({ seedByte: 10 });
    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: key,
      }),
    ).rejects.toThrow(/truncated/);
  });

  it("surfaces create ssh key errors with body text", async () => {
    const key = makeEd25519PublicKey({ seedByte: 11 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: key,
      }),
    ).rejects.toThrow(/create ssh key failed: HTTP 500: boom/);
  });

  it("surfaces list-after-409 errors with body text", async () => {
    const key = makeEd25519PublicKey({ seedByte: 12 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ ssh_keys: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(makeJsonResponse({ error: "conflict" }, 409))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudSshKeyId({
        token: "token",
        name: "clawlets",
        publicKey: key,
      }),
    ).rejects.toThrow(/list ssh keys failed after 409: HTTP 500: boom/);
  });
});

describe("ensureHcloudFirewallId", () => {
  const makeJsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("surfaces list firewall errors with body text", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudFirewallId({
        token: "token",
        name: "fw",
        rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
        labels: { "managed-by": "clawlets" },
      }),
    ).rejects.toThrow(/list firewalls failed: HTTP 500: nope/);
  });

  it("returns existing firewall id by name and uses label_selector", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "clawlets-host-base", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: {
            id: 99,
            name: "clawlets-host-base",
            labels: { "managed-by": "clawlets" },
            rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "clawlets-host-base",
      rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
      labels: { "managed-by": "clawlets" },
    });

    expect(id).toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = String(fetchMock.mock.calls[0]?.[0] || "");
    expect(url).toMatch(/label_selector=/);
  });

  it("surfaces get firewall errors with body text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "fw", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudFirewallId({
        token: "token",
        name: "fw",
        rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
        labels: { "managed-by": "clawlets" },
      }),
    ).rejects.toThrow(/get firewall failed: HTTP 500: boom/);
  });

  it("surfaces set_rules errors with body text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "fw", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: { id: 99, name: "fw", labels: { "managed-by": "clawlets" }, rules: [] },
        }),
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureHcloudFirewallId({
        token: "token",
        name: "fw",
        rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
        labels: { "managed-by": "clawlets" },
      }),
    ).rejects.toThrow(/set firewall rules failed: HTTP 500: nope/);
  });

  it("treats firewall rules as order-insensitive", async () => {
    const rules = [
      { direction: "in" as const, protocol: "udp" as const, port: "41641", source_ips: ["0.0.0.0/0"] },
      { direction: "in" as const, protocol: "icmp" as const, source_ips: ["0.0.0.0/0"], description: "icmp" },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "fw", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: { id: 99, name: "fw", labels: { "managed-by": "clawlets" }, rules: [rules[1]!, rules[0]!] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "fw",
      rules,
      labels: { "managed-by": "clawlets" },
    });

    expect(id).toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("paginates firewall list (next_page) and finds by name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ firewalls: [], meta: { pagination: { next_page: 2 } } }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "clawlets-host-base", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: {
            id: 99,
            name: "clawlets-host-base",
            labels: { "managed-by": "clawlets" },
            rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "clawlets-host-base",
      rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
      labels: { "managed-by": "clawlets" },
    });

    expect(id).toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0] || "")).toMatch(/page=1/);
    expect(String(fetchMock.mock.calls[1]?.[0] || "")).toMatch(/page=2/);
  });

  it("omits label_selector when labels are not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "fw", labels: {} }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: {
            id: 99,
            name: "fw",
            labels: {},
            rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "fw",
      rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
    });

    expect(id).toBe("99");
    const url = String(fetchMock.mock.calls[0]?.[0] || "");
    expect(url).not.toMatch(/label_selector=/);
  });

  it("reconciles rules when firewall exists but rules differ", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewalls: [{ id: 99, name: "clawlets-host-base", labels: { "managed-by": "clawlets" } }],
          meta: { pagination: { next_page: null } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          firewall: {
            id: 99,
            name: "clawlets-host-base",
            labels: { "managed-by": "clawlets" },
            rules: [],
          },
        }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ action: { id: 1 } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "clawlets-host-base",
      rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
      labels: { "managed-by": "clawlets" },
    });

    expect(id).toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const url = String(fetchMock.mock.calls[2]?.[0] || "");
    expect(url).toMatch(/\/actions\/set_rules$/);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("creates firewall when missing", async () => {
    const fetchMock = vi.fn(async () => makeJsonResponse({ firewalls: [], meta: { pagination: { next_page: null } } }));
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ firewalls: [], meta: { pagination: { next_page: null } } }));
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ firewall: { id: 7, name: "fw", labels: {} } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureHcloudFirewallId({
      token: "token",
      name: "fw",
      rules: [{ direction: "in", protocol: "udp", port: "41641", source_ips: ["0.0.0.0/0"] }],
      labels: { "managed-by": "clawlets" },
    });

    expect(id).toBe("7");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });
});

describe("hcloud servers", () => {
  const makeJsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("lists servers with pagination", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          servers: [{ id: 1, name: "a", status: "running", created: "2026-01-01T00:00:00Z", labels: {} }],
          meta: { pagination: { next_page: 2 } },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          servers: [{ id: 2, name: "b", status: "off", created: "2026-01-01T00:00:00Z", labels: {} }],
          meta: { pagination: { next_page: null } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const servers = await listHcloudServers({ token: "token" });
    expect(servers.map((s) => s.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces list servers errors with body text", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listHcloudServers({ token: "token" })).rejects.toThrow(/list servers failed: HTTP 500: nope/);
  });

  it("creates server with firewalls", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        server: { id: 3, name: "c", status: "running", created: "2026-01-01T00:00:00Z", labels: {} },
      }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    const server = await createHcloudServer({
      token: "token",
      name: "c",
      serverType: "cpx22",
      image: "img",
      location: "nbg1",
      userData: "#cloud-config\n{}",
      labels: { "managed-by": "clawlets" },
      firewallIds: ["123"],
    });

    expect(server.id).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || "{}"));
    expect(body.firewalls?.[0]?.firewall).toBe(123);
  });

  it("creates server without firewalls", async () => {
    const fetchMock = vi.fn(async () =>
      makeJsonResponse(
        { server: { id: 4, name: "d", status: "running", created: "2026-01-01T00:00:00Z", labels: {} } },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const server = await createHcloudServer({
      token: "token",
      name: "d",
      serverType: "cpx22",
      image: "img",
      location: "nbg1",
      userData: "#cloud-config\n{}",
      labels: { "managed-by": "clawlets" },
    });

    expect(server.id).toBe(4);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || "{}"));
    expect(body.firewalls).toBeUndefined();
  });

  it("rejects invalid server ids", async () => {
    await expect(getHcloudServer({ token: "token", id: "abc" })).rejects.toThrow(/invalid hcloud server id/i);
    await expect(deleteHcloudServer({ token: "token", id: "abc" })).rejects.toThrow(/invalid hcloud server id/i);
  });

  it("waits for desired status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ server: { id: 5, name: "x", status: "starting", created: "2026-01-01T00:00:00Z", labels: {} } }))
      .mockResolvedValueOnce(makeJsonResponse({ server: { id: 5, name: "x", status: "running", created: "2026-01-01T00:00:00Z", labels: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = waitForHcloudServerStatus({
      token: "token",
      id: "5",
      want: (s) => s === "running",
      pollMs: 1000,
      timeoutMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    const server = await pending;
    expect(server.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out while waiting for status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      makeJsonResponse({
        server: { id: 6, name: "x", status: "starting", created: "2026-01-01T00:00:00Z", labels: {} },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = waitForHcloudServerStatus({
      token: "token",
      id: "6",
      want: (s) => s === "running",
      pollMs: 1000,
      timeoutMs: 1500,
    });

    const assertion = expect(pending).rejects.toThrow(/timeout waiting for server/i);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("surfaces delete server errors with body", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteHcloudServer({ token: "token", id: "7" })).rejects.toThrow(/HTTP 500: boom/);
  });
});
