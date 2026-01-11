import { describe, it, expect, vi, beforeEach } from "vitest";

const nixToolsState: {
  lastShellArgs: string[] | null;
} = {
  lastShellArgs: null,
};

const runState: {
  lastArgs: string[] | null;
} = {
  lastArgs: null,
};

vi.mock("../src/lib/nix-tools.js", () => ({
  nixShellCapture: vi.fn(async (_pkg: string, _cmd: string, args: string[]) => {
    nixToolsState.lastShellArgs = args;
    return "<decrypted>";
  }),
}));

vi.mock("../src/lib/run.js", () => ({
  run: vi.fn(async (_cmd: string, args: string[]) => {
    runState.lastArgs = args;
  }),
}));

beforeEach(() => {
  nixToolsState.lastShellArgs = null;
  runState.lastArgs = null;
  vi.resetModules();
});

describe("sops args", () => {
  it("decrypt uses the expected sops args", async () => {
    const { sopsDecryptYamlFile } = await import("../src/lib/sops");
    await sopsDecryptYamlFile({
      filePath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      filenameOverride: "clawdbot-fleet-host.yaml",
      ageKeyFile: "/tmp/operator.agekey",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(nixToolsState.lastShellArgs).not.toBeNull();
    const args = nixToolsState.lastShellArgs!;
    expect(args[0]).toBe("decrypt");
    expect(args).toContain("--filename-override");
    expect(args).toContain("clawdbot-fleet-host.yaml");
    expect(args[args.length - 1]).toBe("/tmp/hosts/clawdbot-fleet-host.yaml");
  });

  it("encrypt defaults filename-override to outPath", async () => {
    const { sopsEncryptYamlToFile } = await import("../src/lib/sops");
    await sopsEncryptYamlToFile({
      plaintextYaml: "hello: world\n",
      outPath: "/tmp/hosts/clawdbot-fleet-host.yaml",
      nix: { nixBin: "nix", dryRun: true },
    });

    expect(runState.lastArgs).not.toBeNull();
    const args = runState.lastArgs!;
    const idxEncrypt = args.indexOf("encrypt");
    expect(idxEncrypt).toBeGreaterThanOrEqual(0);
    const idxOverride = args.indexOf("--filename-override");
    expect(idxOverride).toBeGreaterThanOrEqual(0);
    expect(args[idxOverride + 1]).toBe("/tmp/hosts/clawdbot-fleet-host.yaml");
  });
});
