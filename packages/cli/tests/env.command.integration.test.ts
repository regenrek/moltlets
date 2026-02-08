import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
      envFile: { status: "ok", origin: "default", path: "/repo/.clawlets/env" },
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
      envFile: { status: "ok", origin: "default", path: `${repoRoot}/.clawlets/env` },
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
      const runtimeDir = path.join(repoRoot, ".clawlets");
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
      expect(String(payload.keyPath || "")).toContain(".clawlets/keys/operators/alice.agekey");
      expect(fs.existsSync(payload.keyPath)).toBe(true);
      expect(fs.existsSync(`${payload.keyPath}.pub`)).toBe(true);
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
    const envText = fs.readFileSync(path.join(repoRoot, ".clawlets", "env"), "utf8");
    expect(envText).toContain("HCLOUD_TOKEN=token-1");
    expect(envText).toContain("GITHUB_TOKEN=token-2");
  });
});
