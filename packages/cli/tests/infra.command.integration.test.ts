import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig, baseHost } from "./fixtures.js";
import { getRepoLayout } from "@clawlets/core/repo-layout";

const provisionMock = vi.fn().mockResolvedValue({
  hostName: "alpha",
  provider: "hetzner",
  instanceId: "srv-1",
  ipv4: "203.0.113.20",
  sshUser: "root",
});
const destroyMock = vi.fn().mockResolvedValue(undefined);
const lockdownMock = vi.fn().mockResolvedValue(undefined);
const getProvisionerDriverMock = vi.fn(() => ({
  id: "hetzner",
  provision: provisionMock,
  destroy: destroyMock,
  lockdown: lockdownMock,
}));
const loadDeployCredsMock = vi.fn();
const expandPathMock = vi.fn((v: string) => v);
const findRepoRootMock = vi.fn(() => "/repo");
const resolveHostNameOrExitMock = vi.fn(() => "alpha");
const loadClawletsConfigMock = vi.fn();

vi.mock("@clawlets/core/lib/infra", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/infra")>(
    "@clawlets/core/lib/infra",
  );
  return {
    ...actual,
    getProvisionerDriver: getProvisionerDriverMock,
  };
});

vi.mock("@clawlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawlets/core/lib/path-expand", () => ({
  expandPath: expandPathMock,
}));

vi.mock("@clawlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/host-resolve", () => ({
  resolveHostNameOrExit: resolveHostNameOrExitMock,
}));

vi.mock("@clawlets/core/lib/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>(
    "@clawlets/core/lib/clawlets-config",
  );
  return {
    ...actual,
    loadClawletsConfig: loadClawletsConfigMock,
  };
});

describe("infra command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies using provider driver", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawlets-infra-"));
    const pubkey = path.join(tmp, "id_ed25519.pub");
    fs.writeFileSync(pubkey, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEk4yXx5oKXxmA3k2xZ6oUw1wK8bC9B8dJr3p+o8k8P test", "utf8");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: {
        ...baseHost,
        provisioning: { ...baseHost.provisioning, adminCidr: "203.0.113.10/32", sshPubkeyFile: pubkey },
      },
    });
    const layout = getRepoLayout("/repo");
    loadClawletsConfigMock.mockReturnValue({ layout, config });
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawlets/env" },
      values: { HCLOUD_TOKEN: "token", NIX_BIN: "nix", GITHUB_TOKEN: "" },
    });
    const { infra } = await import("../src/commands/infra/index.js");
    await infra.subCommands?.apply?.run?.({ args: { host: "alpha", dryRun: true } } as any);
    expect(getProvisionerDriverMock).toHaveBeenCalledWith("hetzner");
    expect(provisionMock).toHaveBeenCalled();
  });

  it("destroy requires force when no TTY", async () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), "clawlets-infra-destroy-"));
    const pubkey = path.join(tmp, "id_ed25519.pub");
    fs.writeFileSync(pubkey, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEk4yXx5oKXxmA3k2xZ6oUw1wK8bC9B8dJr3p+o8k8P test", "utf8");
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, provisioning: { ...baseHost.provisioning, sshPubkeyFile: pubkey } },
    });
    const layout = getRepoLayout("/repo");
    loadClawletsConfigMock.mockReturnValue({ layout, config });
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawlets/env" },
      values: { HCLOUD_TOKEN: "token", NIX_BIN: "nix", GITHUB_TOKEN: "" },
    });
    const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const { infra } = await import("../src/commands/infra/index.js");
    await expect(infra.subCommands?.destroy?.run?.({ args: { host: "alpha" } } as any)).rejects.toThrow(/refusing to destroy/i);
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
  });
});
