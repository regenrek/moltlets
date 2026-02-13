import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findRepoRootMock = vi.hoisted(() => vi.fn());
const resolveNixBinMock = vi.hoisted(() => vi.fn());
const updateDeployCredsEnvFileMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const captureMock = vi.hoisted(() => vi.fn());
const captureWithInputMock = vi.hoisted(() => vi.fn());

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/nix/nix-bin", () => ({
  resolveNixBin: resolveNixBinMock,
}));

vi.mock("@clawlets/core/lib/infra/deploy-creds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawlets/core/lib/infra/deploy-creds")>();
  return {
    ...actual,
    updateDeployCredsEnvFile: updateDeployCredsEnvFileMock,
  };
});

vi.mock("@clawlets/core/lib/runtime/run", () => ({
  run: runMock,
  capture: captureMock,
  captureWithInput: captureWithInputMock,
}));

describe("quickstart command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockResolvedValue(undefined);
    captureMock.mockResolvedValue("");
    captureWithInputMock.mockResolvedValue("");
    updateDeployCredsEnvFileMock.mockResolvedValue({
      envPath: "/tmp/repo/.clawlets/env",
      runtimeDir: "/tmp/repo/.clawlets",
      updatedKeys: ["NIX_BIN"],
    });
  });

  it("fails fast with actionable instructions when nix is missing and --install-nix=never", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-missing-nix-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    resolveNixBinMock.mockReturnValue(null);
    const { quickstart } = await import("../src/commands/quickstart/index.js");

    await expect(
      quickstart.run({
        args: {
          confirm: false,
          installNix: "never",
          ui: "none",
        },
      } as any),
    ).rejects.toThrow(/nix-installer\/releases\/tag\/v3\.15\.2/i);

    expect(updateDeployCredsEnvFileMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("bootstraps convex env and emits summary JSON in non-interactive mode", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-"));
    const webDir = path.join(repoRoot, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    const envFilePath = path.join(webDir, ".env.local");
    fs.writeFileSync(
      envFilePath,
      [
        "CONVEX_DEPLOYMENT=dev:demo-123",
        "VITE_CONVEX_URL=https://demo-123.convex.cloud",
        "",
      ].join("\n"),
      "utf8",
    );

    findRepoRootMock.mockReturnValue(repoRoot);
    resolveNixBinMock.mockReturnValue("/nix/var/nix/profiles/default/bin/nix");
    captureMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "/nix/var/nix/profiles/default/bin/nix" && args[0] === "--version") {
        return "nix (Nix) 2.24.0";
      }
      if (cmd === "npx" && args[0] === "convex" && args[1] === "whoami") {
        return "dev@example.com";
      }
      return "";
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let summary: Record<string, unknown> | null = null;
    try {
      const { quickstart } = await import("../src/commands/quickstart/index.js");
      await quickstart.run({
        args: {
          confirm: false,
          installNix: "auto",
          setupConvex: true,
          convexDir: "apps/web",
          ui: "none",
          json: true,
        },
      } as any);
      summary = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0] || "{}"));
    } finally {
      logSpy.mockRestore();
    }

    expect(updateDeployCredsEnvFileMock).toHaveBeenCalledWith({
      repoRoot,
      updates: { NIX_BIN: "/nix/var/nix/profiles/default/bin/nix" },
    });

    const commandLines = runMock.mock.calls.map(([cmd, args]) => `${String(cmd)} ${Array.isArray(args) ? args.join(" ") : ""}`);
    expect(commandLines).toEqual(
      expect.arrayContaining([
        "corepack enable",
        "pnpm install --frozen-lockfile",
        "npx convex dev --once",
        "npx convex env set SITE_URL http://localhost:3000",
        "npx convex env set CONVEX_SITE_URL https://demo-123.convex.site",
      ]),
    );
    expect(commandLines.some((line) => line.includes("BETTER_AUTH_SECRET"))).toBe(false);
    expect(captureWithInputMock).toHaveBeenCalledWith(
      "npx",
      ["convex", "env", "set", "BETTER_AUTH_SECRET"],
      expect.any(String),
      expect.objectContaining({ cwd: webDir }),
    );

    const envFileText = fs.readFileSync(envFilePath, "utf8");
    expect(envFileText).toContain("VITE_SITE_URL=http://localhost:3000");
    expect(envFileText).toContain("SITE_URL=http://localhost:3000");
    expect(envFileText).toContain("VITE_CONVEX_SITE_URL=https://demo-123.convex.site");
    expect(envFileText).toMatch(/BETTER_AUTH_SECRET=/);
    expect(fs.statSync(envFilePath).mode & 0o777).toBe(0o600);
    expect(summary?.ok).toBe(true);
    expect((summary?.nix as any)?.nixBin).toBe("/nix/var/nix/profiles/default/bin/nix");
    expect((summary?.convex as any)?.deployment).toBe("dev:demo-123");
  });

  it("is idempotent on rerun and preserves existing auth secret", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-rerun-"));
    const webDir = path.join(repoRoot, "apps", "web");
    fs.mkdirSync(webDir, { recursive: true });
    const envFilePath = path.join(webDir, ".env.local");
    fs.writeFileSync(
      envFilePath,
      [
        "CONVEX_DEPLOYMENT=dev:demo-123",
        "VITE_CONVEX_URL=https://demo-123.convex.cloud",
        "BETTER_AUTH_SECRET=stable-secret",
        "",
      ].join("\n"),
      "utf8",
    );

    findRepoRootMock.mockReturnValue(repoRoot);
    resolveNixBinMock.mockReturnValue("/nix/var/nix/profiles/default/bin/nix");
    captureMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "/nix/var/nix/profiles/default/bin/nix" && args[0] === "--version") {
        return "nix (Nix) 2.24.0";
      }
      if (cmd === "npx" && args[0] === "convex" && args[1] === "whoami") {
        return "dev@example.com";
      }
      return "";
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { quickstart } = await import("../src/commands/quickstart/index.js");
      const args = {
        confirm: false,
        installNix: "auto",
        setupConvex: true,
        convexDir: "apps/web",
        ui: "none",
      };
      await quickstart.run({ args } as any);
      await quickstart.run({ args } as any);
    } finally {
      logSpy.mockRestore();
    }

    const commandLines = runMock.mock.calls.map(([cmd, args]) => `${String(cmd)} ${Array.isArray(args) ? args.join(" ") : ""}`);
    expect(commandLines.join("\n")).not.toContain("stable-secret");
    expect(captureWithInputMock).toHaveBeenCalledTimes(2);
    for (const call of captureWithInputMock.mock.calls) {
      expect(call[2]).toBe("stable-secret\n");
    }

    const envFileText = fs.readFileSync(envFilePath, "utf8");
    expect(envFileText).toContain("BETTER_AUTH_SECRET=stable-secret");
    expect((envFileText.match(/^BETTER_AUTH_SECRET=/gm) || []).length).toBe(1);
    expect((envFileText.match(/^VITE_SITE_URL=/gm) || []).length).toBe(1);
    expect((envFileText.match(/^VITE_CONVEX_URL=/gm) || []).length).toBe(1);
    expect(fs.statSync(envFilePath).mode & 0o777).toBe(0o600);
  });

  it("rejects --json unless --ui=none", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-json-ui-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const { quickstart } = await import("../src/commands/quickstart/index.js");

    await expect(
      quickstart.run({
        args: {
          confirm: false,
          json: true,
          ui: "dev",
        },
      } as any),
    ).rejects.toThrow(/--json requires --ui=none/i);

    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects --convex-dir outside repo root", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-root-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-quickstart-outside-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const { quickstart } = await import("../src/commands/quickstart/index.js");

    await expect(
      quickstart.run({
        args: {
          confirm: false,
          installNix: "auto",
          setupConvex: false,
          ui: "none",
          convexDir: outsideDir,
        },
      } as any),
    ).rejects.toThrow(/--convex-dir must resolve inside repo root/i);

    expect(runMock).not.toHaveBeenCalled();
  });
});
