import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getRepoLayout } from "@clawlets/core/repo-layout";

const findRepoRootMock = vi.fn();
const loadDeployCredsMock = vi.fn();
const ageKeygenMock = vi.fn();

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/security/age-keygen", () => ({
  ageKeygen: ageKeygenMock,
}));

vi.mock("@clawlets/core/lib/infra/deploy-creds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawlets/core/lib/infra/deploy-creds")>();
  return {
    ...actual,
    loadDeployCreds: loadDeployCredsMock,
  };
});

describe("env commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("env init writes explicit env file", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const envFile = path.join(repoRoot, ".env.custom");
    const { envInit } = await import("../src/commands/infra/env.js");
    await envInit.run({ args: { envFile } } as any);
    const content = fs.readFileSync(envFile, "utf8");
    expect(content).toMatch(/HCLOUD_TOKEN=/);
    expect(content).toMatch(/AWS_ACCESS_KEY_ID=/);
    expect(content).toMatch(/AWS_SECRET_ACCESS_KEY=/);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("note: pass --env-file"));
  });

  it("env show prints resolved values", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-show-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", origin: "default", path: "/runtime/env" },
      values: {
        HCLOUD_TOKEN: "token",
        GITHUB_TOKEN: "gh",
        NIX_BIN: "nix",
        SOPS_AGE_KEY_FILE: "/keys/age",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_SESSION_TOKEN: "",
      },
      sources: {
        HCLOUD_TOKEN: "file",
        GITHUB_TOKEN: "env",
        NIX_BIN: "default",
        SOPS_AGE_KEY_FILE: "file",
        AWS_ACCESS_KEY_ID: "file",
        AWS_SECRET_ACCESS_KEY: "file",
        AWS_SESSION_TOKEN: "unset",
      },
    });
    const { envShow } = await import("../src/commands/infra/env.js");
    await envShow.run({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("env file: ok"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("HCLOUD_TOKEN: set"));
  });

  it("env show --json emits machine-readable status", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-json-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", origin: "default", path: `${repoRoot}/runtime/env` },
      values: {
        HCLOUD_TOKEN: "token",
        GITHUB_TOKEN: "gh",
        NIX_BIN: "nix",
        SOPS_AGE_KEY_FILE: "/keys/age",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_SESSION_TOKEN: "",
      },
      sources: {
        HCLOUD_TOKEN: "file",
        GITHUB_TOKEN: "env",
        NIX_BIN: "default",
        SOPS_AGE_KEY_FILE: "file",
        AWS_ACCESS_KEY_ID: "file",
        AWS_SECRET_ACCESS_KEY: "file",
        AWS_SESSION_TOKEN: "unset",
      },
    });
    const { envShow } = await import("../src/commands/infra/env.js");
    await envShow.run({ args: { json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
    expect(payload.repoRoot).toBe(repoRoot);
    expect(Array.isArray(payload.keys)).toBe(true);
    expect(payload.keys.find((row: any) => row.key === "HCLOUD_TOKEN")?.status).toBe("set");
  });

  it("env detect-age-key --json recommends a valid key file", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-detect-"));
      const runtimeDir = getRepoLayout(repoRoot).runtimeDir;
      fs.mkdirSync(path.join(runtimeDir, "keys", "operators"), { recursive: true });
      const keyPath = path.join(runtimeDir, "keys", "operators", "alice.agekey");
      fs.writeFileSync(keyPath, "AGE-SECRET-KEY-1TESTKEY\n", "utf8");
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: keyPath,
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "file",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envDetectAgeKey } = await import("../src/commands/infra/env.js");
      await envDetectAgeKey.run({ args: { json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.recommendedPath).toBe(keyPath);
      expect(payload.candidates.some((row: any) => row.path === keyPath && row.valid === true)).toBe(true);
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env detect-age-key --json only scans project-local candidates", async () => {
    const previousHome = process.env.HOME;
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    const fakeHome = fs.mkdtempSync(path.join(tmpdir(), "clawlets-home-"));
    process.env.HOME = fakeHome;
    try {
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-detect-local-"));
      const runtimeDir = getRepoLayout(repoRoot).runtimeDir;
      fs.mkdirSync(path.join(fakeHome, ".config", "sops", "age"), { recursive: true });
      const homeKeyPath = path.join(fakeHome, ".config", "sops", "age", "keys.txt");
      fs.writeFileSync(homeKeyPath, "AGE-SECRET-KEY-1HOMEKEY\n", "utf8");
      fs.mkdirSync(path.join(runtimeDir, "keys", "operators"), { recursive: true });
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "unset",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envDetectAgeKey } = await import("../src/commands/infra/env.js");
      await envDetectAgeKey.run({ args: { json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.candidates.some((row: any) => row.path === homeKeyPath)).toBe(false);
      expect(payload.recommendedPath).toBe(null);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env generate-age-key --json writes key pair and reports path", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      ageKeygenMock.mockResolvedValue({
        fileText: "# public key: age1test\nAGE-SECRET-KEY-1TEST\n",
        publicKey: "age1test",
      });
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-generate-"));
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "unset",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envGenerateAgeKey } = await import("../src/commands/infra/env.js");
      await envGenerateAgeKey.run({ args: { json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.ok).toBe(true);
      expect(payload.created).toBe(true);
      expect(String(payload.keyPath || "")).toContain(`${path.sep}keys${path.sep}operators${path.sep}alice.agekey`);
      expect(fs.existsSync(payload.keyPath)).toBe(true);
      expect(fs.existsSync(`${payload.keyPath}.pub`)).toBe(true);
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env generate-age-key --host writes host-scoped key without changing SOPS_AGE_KEY_FILE", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      ageKeygenMock.mockResolvedValue({
        fileText: "# public key: age1hostscoped\nAGE-SECRET-KEY-1HOSTSCOPED\n",
        publicKey: "age1hostscoped",
      });
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-generate-host-"));
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "unset",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envGenerateAgeKey } = await import("../src/commands/infra/env.js");
      await envGenerateAgeKey.run({ args: { host: "openclaw-fleet-host", json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      const runtimeDir = getRepoLayout(repoRoot).runtimeDir;
      const expectedKeyPath = path.join(
        runtimeDir,
        "keys",
        "operators",
        "hosts",
        "openclaw-fleet-host",
        "alice.agekey",
      );
      expect(payload.ok).toBe(true);
      expect(payload.host).toBe("openclaw-fleet-host");
      expect(payload.keyPath).toBe(expectedKeyPath);
      expect(fs.existsSync(expectedKeyPath)).toBe(true);
      expect(fs.existsSync(`${expectedKeyPath}.pub`)).toBe(true);
      expect(fs.existsSync(getRepoLayout(repoRoot).envFilePath)).toBe(false);
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env generate-age-key --json reuses existing valid key and updates env", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-generate-existing-"));
      const keyPath = path.join(getRepoLayout(repoRoot).runtimeDir, "keys", "operators", "alice.agekey");
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, "# public key: age1existing\nAGE-SECRET-KEY-1EXISTING\n", "utf8");
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "unset",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envGenerateAgeKey } = await import("../src/commands/infra/env.js");
      await envGenerateAgeKey.run({ args: { json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.ok).toBe(true);
      expect(payload.created).toBe(false);
      expect(payload.keyPath).toBe(keyPath);
      expect(payload.publicKey).toBe("age1existing");
      const envText = fs.readFileSync(getRepoLayout(repoRoot).envFilePath, "utf8");
      expect(envText).toContain(`SOPS_AGE_KEY_FILE=${keyPath}`);
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env detect-age-key --host only resolves host-scoped candidates", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-detect-host-"));
      const runtimeDir = getRepoLayout(repoRoot).runtimeDir;
      const hostKeyPath = path.join(
        runtimeDir,
        "keys",
        "operators",
        "hosts",
        "openclaw-fleet-host",
        "alice.agekey",
      );
      const otherHostKeyPath = path.join(
        runtimeDir,
        "keys",
        "operators",
        "hosts",
        "other-host",
        "alice.agekey",
      );
      fs.mkdirSync(path.dirname(hostKeyPath), { recursive: true });
      fs.mkdirSync(path.dirname(otherHostKeyPath), { recursive: true });
      fs.writeFileSync(hostKeyPath, "AGE-SECRET-KEY-1HOSTKEY\n", "utf8");
      fs.writeFileSync(otherHostKeyPath, "AGE-SECRET-KEY-1OTHERHOST\n", "utf8");
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: otherHostKeyPath,
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "file",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envDetectAgeKey } = await import("../src/commands/infra/env.js");
      await envDetectAgeKey.run({ args: { host: "openclaw-fleet-host", json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.host).toBe("openclaw-fleet-host");
      expect(payload.recommendedPath).toBe(hostKeyPath);
      expect(payload.candidates.some((row: any) => row.path === otherHostKeyPath)).toBe(false);
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env generate-age-key --json fails when existing key file is invalid", async () => {
    const previousUser = process.env.USER;
    process.env.USER = "alice";
    try {
      const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-generate-invalid-"));
      const keyPath = path.join(getRepoLayout(repoRoot).runtimeDir, "keys", "operators", "alice.agekey");
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, "not-an-age-key\n", "utf8");
      findRepoRootMock.mockReturnValue(repoRoot);
      loadDeployCredsMock.mockReturnValue({
        envFile: null,
        values: {
          HCLOUD_TOKEN: "",
          GITHUB_TOKEN: "",
          NIX_BIN: "nix",
          SOPS_AGE_KEY_FILE: "",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_SESSION_TOKEN: "",
        },
        sources: {
          HCLOUD_TOKEN: "unset",
          GITHUB_TOKEN: "unset",
          NIX_BIN: "default",
          SOPS_AGE_KEY_FILE: "unset",
          AWS_ACCESS_KEY_ID: "unset",
          AWS_SECRET_ACCESS_KEY: "unset",
          AWS_SESSION_TOKEN: "unset",
        },
      });
      const { envGenerateAgeKey } = await import("../src/commands/infra/env.js");
      await envGenerateAgeKey.run({ args: { json: true } } as any);
      const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
      expect(payload.ok).toBe(false);
      expect(String(payload.message || "")).toContain("existing key file invalid");
    } finally {
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
    }
  });

  it("env apply-json writes specified deploy creds keys", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-apply-json-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const inputPath = path.join(repoRoot, "updates.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        HCLOUD_TOKEN: "token-1",
        GITHUB_TOKEN: "token-2",
        NOPE: "ignored",
      }),
      "utf8",
    );
    const { envApplyJson } = await import("../src/commands/infra/env.js");
    await envApplyJson.run({ args: { fromJson: inputPath, json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
    expect(payload.ok).toBe(true);
    expect(payload.updatedKeys).toContain("HCLOUD_TOKEN");
    expect(payload.updatedKeys).toContain("GITHUB_TOKEN");
    const envText = fs.readFileSync(getRepoLayout(repoRoot).envFilePath, "utf8");
    expect(envText).toContain("HCLOUD_TOKEN=token-1");
    expect(envText).toContain("GITHUB_TOKEN=token-2");
  });

  it("env token-keyring-mutate adds a key and sets active id", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-token-keyring-add-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: null,
      values: {
        HCLOUD_TOKEN_KEYRING: "",
        HCLOUD_TOKEN_KEYRING_ACTIVE: "",
      },
      sources: {
        HCLOUD_TOKEN_KEYRING: "unset",
        HCLOUD_TOKEN_KEYRING_ACTIVE: "unset",
      },
    });
    const inputPath = path.join(repoRoot, "mutate.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        kind: "hcloud",
        action: "add",
        label: "Laptop",
        value: "hcloud-secret-1",
      }),
      "utf8",
    );
    const { envTokenKeyringMutate } = await import("../src/commands/infra/env-token-keyring-mutate.js");
    await envTokenKeyringMutate.run({ args: { fromJson: inputPath, json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
    expect(payload.ok).toBe(true);
    expect(payload.kind).toBe("hcloud");
    expect(payload.action).toBe("add");
    expect(payload.itemCount).toBe(1);
    expect(payload.hasActive).toBe(true);
    expect(typeof payload.keyId).toBe("string");

    const envText = fs.readFileSync(getRepoLayout(repoRoot).envFilePath, "utf8");
    expect(envText).toContain("HCLOUD_TOKEN_KEYRING=");
    expect(envText).toContain("HCLOUD_TOKEN_KEYRING_ACTIVE=");
  });

  it("env token-keyring-mutate remove updates active id fallback", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-token-keyring-remove-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: null,
      values: {
        HCLOUD_TOKEN_KEYRING:
          '{"items":[{"id":"a","label":"A","value":"tok-a"},{"id":"b","label":"B","value":"tok-b"}]}',
        HCLOUD_TOKEN_KEYRING_ACTIVE: "a",
      },
      sources: {
        HCLOUD_TOKEN_KEYRING: "file",
        HCLOUD_TOKEN_KEYRING_ACTIVE: "file",
      },
    });
    const inputPath = path.join(repoRoot, "mutate-remove.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        kind: "hcloud",
        action: "remove",
        keyId: "a",
      }),
      "utf8",
    );
    const { envTokenKeyringMutate } = await import("../src/commands/infra/env-token-keyring-mutate.js");
    await envTokenKeyringMutate.run({ args: { fromJson: inputPath, json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
    expect(payload.ok).toBe(true);
    expect(payload.itemCount).toBe(1);
    expect(payload.hasActive).toBe(true);
    expect(payload.updatedKeys).toEqual(["HCLOUD_TOKEN_KEYRING", "HCLOUD_TOKEN_KEYRING_ACTIVE"]);

    const envText = fs.readFileSync(getRepoLayout(repoRoot).envFilePath, "utf8");
    expect(envText).toContain("HCLOUD_TOKEN_KEYRING_ACTIVE=b");
  });

  it("env token-keyring-mutate rejects unknown select id", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-env-token-keyring-select-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    loadDeployCredsMock.mockReturnValue({
      envFile: null,
      values: {
        HCLOUD_TOKEN_KEYRING: '{"items":[{"id":"a","label":"A","value":"tok-a"}]}',
        HCLOUD_TOKEN_KEYRING_ACTIVE: "a",
      },
      sources: {
        HCLOUD_TOKEN_KEYRING: "file",
        HCLOUD_TOKEN_KEYRING_ACTIVE: "file",
      },
    });
    const inputPath = path.join(repoRoot, "mutate-select.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        kind: "hcloud",
        action: "select",
        keyId: "missing",
      }),
      "utf8",
    );
    const { envTokenKeyringMutate } = await import("../src/commands/infra/env-token-keyring-mutate.js");
    await expect(
      envTokenKeyringMutate.run({ args: { fromJson: inputPath, json: true } } as any),
    ).rejects.toThrow(/key not found/i);
  });
});
