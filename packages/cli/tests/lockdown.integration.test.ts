import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoLayout } from "@clawlets/core/repo-layout";

const sshRunMock = vi.fn().mockResolvedValue(undefined);
const sshCaptureMock = vi.fn().mockResolvedValue(
  JSON.stringify([{ outputs: { out: "/nix/store/lockdown-test-system" } }]),
);
const lockdownMock = vi.fn().mockResolvedValue(undefined);
const getProvisionerDriverMock = vi.fn(() => ({
  id: "hetzner",
  provision: vi.fn(),
  destroy: vi.fn(),
  lockdown: lockdownMock,
}));
const resolveGitRevMock = vi.fn().mockResolvedValue("0123456789abcdef0123456789abcdef01234567");
const loadDeployCredsMock = vi.fn();
const findRepoRootMock = vi.fn().mockReturnValue("/repo");
const resolveBaseFlakeMock = vi.fn().mockResolvedValue({ flake: "github:owner/repo" });
const loadClawletsConfigMock = vi.fn();
const requireDeployGateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@clawlets/core/lib/security/ssh-remote", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/security/ssh-remote")>(
    "@clawlets/core/lib/security/ssh-remote",
  );
  return {
    ...actual,
    sshRun: sshRunMock,
    sshCapture: sshCaptureMock,
  };
});

vi.mock("@clawlets/core/lib/infra/infra", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/infra/infra")>(
    "@clawlets/core/lib/infra/infra",
  );
  return {
    ...actual,
    getProvisionerDriver: getProvisionerDriverMock,
  };
});

vi.mock("@clawlets/core/lib/vcs/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawlets/core/lib/infra/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/nix/base-flake", () => ({
  resolveBaseFlake: resolveBaseFlakeMock,
}));

vi.mock("@clawlets/core/lib/config/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/config/clawlets-config")>(
    "@clawlets/core/lib/config/clawlets-config",
  );
  return {
    ...actual,
    loadClawletsConfig: loadClawletsConfigMock,
  };
});

vi.mock("../src/lib/deploy-gate.js", () => ({
  requireDeployGate: requireDeployGateMock,
}));

const hostName = "openclaw-beta-4";
const baseHost = {
  enable: true,
  gatewaysOrder: ["maren"],
  gateways: { maren: {} },
  diskDevice: "/dev/sda",
  flakeHost: "",
  targetHost: "admin@100.64.0.10",
  hetzner: { serverType: "cx43", location: "nbg1", image: "debian-12" },
  provisioning: { adminCidr: "203.0.113.10/32", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "tailnet" },
  tailnet: { mode: "tailscale" },
  operator: { deploy: { enable: true } },
  agentModelPrimary: "zai/glm-4.7",
};

function setConfig() {
  loadClawletsConfigMock.mockReturnValue({
    layout: getRepoLayout("/repo"),
    configPath: "/repo/fleet/clawlets.json",
    config: {
      schemaVersion: 1,
      defaultHost: hostName,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        sshAuthorizedKeys: [],
        sshKnownHosts: [],
        codex: { enable: false, gateways: [] },
        backups: { restic: { enable: false, repository: "" } },
      },
      hosts: {
        [hostName]: baseHost,
      },
    },
  });
}

describe("lockdown command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConfig();
    loadDeployCredsMock.mockReturnValue({
      envFile: { status: "ok", path: "/repo/.clawlets/env" },
      values: { HCLOUD_TOKEN: "token", GITHUB_TOKEN: "", NIX_BIN: "nix" },
    });
  });

  it("applies provider lockdown without ssh", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(tmpdir(), "clawlets-lockdown-"));
    const keyPath = path.join(tempDir, "id_ed25519.pub");
    await fs.promises.writeFile(keyPath, "ssh-ed25519 AAAA", "utf8");
    loadClawletsConfigMock.mockReturnValue({
      layout: getRepoLayout("/repo"),
      configPath: "/repo/fleet/clawlets.json",
      config: {
        schemaVersion: 1,
        defaultHost: hostName,
        fleet: {
          secretEnv: {},
          secretFiles: {},
          sshAuthorizedKeys: [],
          sshKnownHosts: [],
          codex: { enable: false, gateways: [] },
          backups: { restic: { enable: false, repository: "" } },
        },
        hosts: {
          [hostName]: {
            ...baseHost,
            provisioning: {
              ...baseHost.provisioning,
              sshPubkeyFile: keyPath,
            },
          },
        },
      },
    });

    const { lockdown } = await import("../src/commands/infra/lockdown.ts");
    await lockdown.run({
      args: {
        host: hostName,
        rev: "HEAD",
        ref: "",
        skipRebuild: false,
        skipTofu: false,
        dryRun: true,
        sshTty: false,
      } as any,
    });

    expect(lockdownMock).toHaveBeenCalled();
    expect(sshCaptureMock).not.toHaveBeenCalled();
    expect(sshRunMock).not.toHaveBeenCalled();
  });
});
