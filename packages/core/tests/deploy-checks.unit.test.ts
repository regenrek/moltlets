import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDeployChecks } from "../src/doctor/deploy-checks.js";
import { getRepoLayout } from "../src/repo-layout.js";
import * as sopsRules from "../src/lib/security/sops-rules.js";
import type { DoctorCheck } from "../src/doctor/types.js";

const captureMock = vi.fn();
const loadClawletsConfigMock = vi.fn();
const getSshExposureModeMock = vi.fn();
const isPublicSshExposureMock = vi.fn();
const validateHostSecretsYamlFilesMock = vi.fn();
const buildFleetSecretsPlanMock = vi.fn();
const mapWithConcurrencyMock = vi.fn();
const sopsDecryptYamlFileMock = vi.fn();
const readYamlScalarFromMappingMock = vi.fn();
const resolveBaseFlakeMock = vi.fn();
const agePublicKeyFromIdentityFileMock = vi.fn();
const getSopsCreationRuleAgeRecipientsMock = vi.fn();
const resolveBundledOpenTofuAssetDirMock = vi.fn();
const tryGetOriginFlakeMock = vi.fn();
const tryParseGithubFlakeUriMock = vi.fn();
const checkGithubRepoVisibilityMock = vi.fn();

vi.mock("../src/lib/runtime/run.js", () => ({
  capture: (...args: any[]) => captureMock(...args),
}));

vi.mock("../src/lib/config/clawlets-config.js", () => ({
  loadClawletsConfig: (...args: any[]) => loadClawletsConfigMock(...args),
  getSshExposureMode: (...args: any[]) => getSshExposureModeMock(...args),
  isPublicSshExposure: (...args: any[]) => isPublicSshExposureMock(...args),
}));

vi.mock("../src/lib/secrets/secrets-policy.js", () => ({
  validateHostSecretsYamlFiles: (...args: any[]) => validateHostSecretsYamlFilesMock(...args),
}));

vi.mock("../src/lib/secrets/plan.js", () => ({
  buildFleetSecretsPlan: (...args: any[]) => buildFleetSecretsPlanMock(...args),
}));

vi.mock("../src/lib/runtime/concurrency.js", () => ({
  mapWithConcurrency: (...args: any[]) => mapWithConcurrencyMock(...args),
}));

vi.mock("../src/lib/security/sops.js", () => ({
  sopsDecryptYamlFile: (...args: any[]) => sopsDecryptYamlFileMock(...args),
}));

vi.mock("../src/lib/storage/yaml-scalar.js", () => ({
  readYamlScalarFromMapping: (...args: any[]) => readYamlScalarFromMappingMock(...args),
}));

vi.mock("../src/lib/nix/base-flake.js", () => ({
  resolveBaseFlake: (...args: any[]) => resolveBaseFlakeMock(...args),
}));

vi.mock("../src/lib/security/age-keygen.js", () => ({
  agePublicKeyFromIdentityFile: (...args: any[]) => agePublicKeyFromIdentityFileMock(...args),
}));

vi.mock("../src/lib/security/sops-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/security/sops-config.js")>();
  return {
    ...actual,
    getSopsCreationRuleAgeRecipients: (...args: any[]) => getSopsCreationRuleAgeRecipientsMock(...args),
  };
});

vi.mock("../src/lib/infra/opentofu-assets.js", () => ({
  resolveBundledOpenTofuAssetDir: (...args: any[]) => resolveBundledOpenTofuAssetDirMock(...args),
}));

vi.mock("../src/lib/vcs/git.js", () => ({
  tryGetOriginFlake: (...args: any[]) => tryGetOriginFlakeMock(...args),
}));

vi.mock("../src/lib/vcs/github.js", () => ({
  tryParseGithubFlakeUri: (...args: any[]) => tryParseGithubFlakeUriMock(...args),
  checkGithubRepoVisibility: (...args: any[]) => checkGithubRepoVisibilityMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  captureMock.mockResolvedValue("nix (mock) 2.0");
  loadClawletsConfigMock.mockImplementation(() => {
    throw new Error("invalid config");
  });
  getSshExposureModeMock.mockReturnValue("tailnet");
  isPublicSshExposureMock.mockReturnValue(false);
  validateHostSecretsYamlFilesMock.mockReturnValue({ ok: true, violations: [] });
  buildFleetSecretsPlanMock.mockReturnValue({
    missingSecretConfig: [],
    gateways: [],
    hostSecretNamesRequired: ["admin_password_hash"],
    secretNamesAll: [],
    secretNamesRequired: ["admin_password_hash"],
  });
  mapWithConcurrencyMock.mockImplementation(async ({ items, fn }: { items: unknown[]; fn: (item: unknown) => Promise<unknown> }) => {
    return await Promise.all(items.map((item) => fn(item)));
  });
  sopsDecryptYamlFileMock.mockResolvedValue("admin_password_hash: real");
  readYamlScalarFromMappingMock.mockReturnValue("real");
  resolveBaseFlakeMock.mockResolvedValue({ flake: null });
  agePublicKeyFromIdentityFileMock.mockResolvedValue("age1operator");
  getSopsCreationRuleAgeRecipientsMock.mockReturnValue(["age1operator"]);
  resolveBundledOpenTofuAssetDirMock.mockReturnValue("/tmp/assets/opentofu");
  tryGetOriginFlakeMock.mockResolvedValue(null);
  tryParseGithubFlakeUriMock.mockImplementation((value: string) => {
    const m = String(value || "").match(/^github:([^/]+)\/([^/]+)$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  });
  checkGithubRepoVisibilityMock.mockResolvedValue({ ok: true, status: "public" });
});

async function withTempRepo(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-deploy-checks-"));
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function byLabel(checks: DoctorCheck[], label: string): DoctorCheck | undefined {
  return checks.find((row) => row.label === label);
}

describe("deploy checks", () => {
  it("handles updates scope failures and skips github token checks", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      captureMock.mockRejectedValueOnce(new Error("nix missing"));
      loadClawletsConfigMock.mockImplementationOnce(() => {
        throw new Error("broken fleet config");
      });

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: "alpha",
        nixBin: "nix",
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "updates",
      });

      expect(byLabel(checks, "nix")?.status).toBe("missing");
      expect(byLabel(checks, "clawlets config")?.status).toBe("warn");
      expect(byLabel(checks, "sops config")?.status).toBe("missing");
      expect(byLabel(checks, "SOPS_AGE_KEY_FILE")?.status).toBe("warn");
      expect(byLabel(checks, "GITHUB_TOKEN")).toEqual({
        scope: "updates",
        status: "ok",
        label: "GITHUB_TOKEN",
        detail: "(not required; cache-only updates)",
      });
    });
  });

  it("covers bootstrap branches for aws config, secrets checks, and skip-github mode", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      const hostSecretsDir = path.join(layout.secretsHostsDir, hostName);
      await mkdir(hostSecretsDir, { recursive: true });
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });
      await writeFile(layout.sopsConfigPath, "{", "utf8");
      await writeFile(path.join(hostSecretsDir, "admin_password_hash.yaml"), "admin_password_hash: ENC[x]\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
          },
          hosts: {
            [hostName]: {
              enable: false,
              openclaw: { enable: true },
              provisioning: {
                provider: "aws",
                adminCidr: "",
                sshPubkeyFile: "",
              },
              aws: {
                region: "",
                instanceType: "",
                amiId: "",
                useDefaultVpc: true,
                vpcId: "vpc-123",
                subnetId: "",
              },
              diskDevice: "invalid-device",
              tailnet: { mode: "none" },
              gatewaysOrder: ["gw1"],
              gateways: {
                gw1: {
                  openclaw: { memory: { backend: "qmd" } },
                  agents: { defaults: {} },
                },
              },
            },
          },
        },
      });
      getSshExposureModeMock.mockReturnValue("bootstrap");
      isPublicSshExposureMock.mockReturnValue(true);
      validateHostSecretsYamlFilesMock.mockReturnValue({
        ok: false,
        violations: [
          {
            filePath: path.join(hostSecretsDir, "bad.yaml"),
            line: 7,
            message: "invalid mapping key",
          },
        ],
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: [
          {
            kind: "envVar",
            gateway: "gw1",
            envVar: "DISCORD_TOKEN",
          },
        ],
        gateways: ["gw1"],
        hostSecretNamesRequired: ["admin_password_hash"],
        secretNamesAll: ["discord_token"],
        secretNamesRequired: ["admin_password_hash", "discord_token"],
      });
      resolveBundledOpenTofuAssetDirMock.mockImplementationOnce(() => {
        throw new Error("missing bundled aws OpenTofu assets");
      });

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        hcloudToken: "",
        skipGithubTokenCheck: true,
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "HCLOUD_TOKEN")?.status).toBe("missing");
      expect(byLabel(checks, "sshExposure")?.status).toBe("warn");
      expect(byLabel(checks, "tailnet configured")?.status).toBe("warn");
      expect(byLabel(checks, "opentofu assets (aws)")?.status).toBe("missing");
      expect(String(byLabel(checks, "opentofu assets (aws)")?.detail || "")).toContain("missing bundled aws OpenTofu assets");
      expect(byLabel(checks, "aws.useDefaultVpc")?.status).toBe("warn");
      expect(byLabel(checks, "diskDevice")?.status).toBe("missing");
      expect(byLabel(checks, "memory persistence")?.status).toBe("warn");
      expect(byLabel(checks, "secrets integrity")?.status).toBe("missing");
      expect(byLabel(checks, "fleet secrets")?.status).toBe("missing");
      expect(byLabel(checks, "secret: admin_password_hash")?.status).toBe("ok");
      expect(byLabel(checks, "secret: discord_token")?.status).toBe("missing");
      expect(byLabel(checks, "GITHUB_TOKEN")?.detail).toContain("skipped");
    });
  });

  it("requires github token when bootstrap target resolves to private github flake", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      tryGetOriginFlakeMock.mockResolvedValue("github:acme/private-repo");
      checkGithubRepoVisibilityMock.mockResolvedValue({ ok: true, status: "private-or-missing" });

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: "alpha",
        nixBin: "nix",
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "GITHUB_TOKEN")?.status).toBe("missing");
    });
  });

  it("classifies github visibility results for token and no-token flows", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      tryGetOriginFlakeMock.mockResolvedValue("github:acme/repo");

      const withTokenCases = [
        { status: "public", expected: "ok" },
        { status: "unauthorized", expected: "missing" },
        { status: "private-or-missing", expected: "missing" },
        { status: "rate-limited", expected: "warn" },
      ] as const;
      for (const row of withTokenCases) {
        checkGithubRepoVisibilityMock.mockResolvedValueOnce({ ok: true, status: row.status });
        const checks: DoctorCheck[] = [];
        await addDeployChecks({
          cwd: repoRoot,
          repoRoot,
          layout,
          host: "alpha",
          nixBin: "nix",
          githubToken: "ghp_test",
          push: (entry) => checks.push(entry),
          fleetGateways: null,
          scope: "bootstrap",
        });
        expect(byLabel(checks, "GITHUB_TOKEN")?.status).toBe(row.expected);
      }

      const noTokenCases = [
        { status: "public", expected: "ok" },
        { status: "private-or-missing", expected: "missing" },
        { status: "rate-limited", expected: "warn" },
      ] as const;
      for (const row of noTokenCases) {
        checkGithubRepoVisibilityMock.mockResolvedValueOnce({ ok: true, status: row.status });
        const checks: DoctorCheck[] = [];
        await addDeployChecks({
          cwd: repoRoot,
          repoRoot,
          layout,
          host: "alpha",
          nixBin: "nix",
          push: (entry) => checks.push(entry),
          fleetGateways: null,
          scope: "bootstrap",
        });
        expect(byLabel(checks, "GITHUB_TOKEN")?.status).toBe(row.expected);
      }
    });
  });

  it("validates secret values and sops recipient drift when decrypting required secrets", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      const hostSecretsDir = path.join(layout.secretsHostsDir, hostName);
      await mkdir(hostSecretsDir, { recursive: true });
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });

      const sopsAgeKeyFile = path.join(repoRoot, "operator.agekey");
      await writeFile(sopsAgeKeyFile, "AGE-SECRET-KEY-1TEST\n", "utf8");
      await writeFile(layout.sopsConfigPath, "creation_rules: []\n", "utf8");
      await writeFile(path.join(hostSecretsDir, "admin_password_hash.yaml"), "admin_password_hash: ENC[x]\n", "utf8");
      await writeFile(path.join(hostSecretsDir, "discord_token.yaml"), "discord_token: ENC[y]\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
            sshAuthorizedKeys: [],
          },
          hosts: {
            [hostName]: {
              enable: true,
              targetHost: "203.0.113.10",
              openclaw: { enable: true },
              provisioning: {
                provider: "hetzner",
                adminCidr: "10.0.0.0/24",
                sshPubkeyFile: "",
              },
              hetzner: {
                serverType: "cpx22",
              },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: [],
        gateways: [],
        hostSecretNamesRequired: ["admin_password_hash", "discord_token"],
        secretNamesAll: ["admin_password_hash", "discord_token"],
        secretNamesRequired: ["admin_password_hash", "discord_token"],
      });
      sopsDecryptYamlFileMock.mockImplementation(async ({ filePath }: { filePath: string }) => {
        if (filePath.endsWith("admin_password_hash.yaml")) return "admin_password_hash: <OPTIONAL>";
        throw new Error("decrypt failed");
      });
      readYamlScalarFromMappingMock.mockImplementation(({ key }: { key: string }) => {
        if (key === "admin_password_hash") return "<OPTIONAL>";
        return "";
      });
      agePublicKeyFromIdentityFileMock.mockResolvedValue("age1operator_current");
      getSopsCreationRuleAgeRecipientsMock.mockReturnValue(["age1different"]);
      tryGetOriginFlakeMock.mockResolvedValue("/tmp/local-path");

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        sopsAgeKeyFile,
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "required secrets")?.status).toBe("warn");
      expect(byLabel(checks, "secret value: admin_password_hash")?.status).toBe("missing");
      expect(byLabel(checks, "secret value: discord_token")?.status).toBe("warn");
      expect(["missing", "warn"]).toContain(byLabel(checks, "sops creation rule (host secrets)")?.status);
      expect(["missing", "warn"]).toContain(byLabel(checks, "sops creation rule (host age key)")?.status);
      expect(byLabel(checks, "GITHUB_TOKEN")?.detail).toContain("not needed");
    });
  });

  it("handles malformed sops config and inline ssh key-content misconfiguration", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });
      await writeFile(layout.sopsConfigPath, "{", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
          },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: {
                provider: "hetzner",
                adminCidr: "10.0.0.0/24",
                sshPubkeyFile: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBadKey test@example",
              },
              hetzner: {
                serverType: "cpx22",
              },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: ["gw1"],
              gateways: { gw1: {} },
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockImplementationOnce(() => {
        throw new Error("secrets-plan failed");
      });

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        skipGithubTokenCheck: true,
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "provisioning ssh pubkey file")?.status).toBe("missing");
      expect(byLabel(checks, "fleet secrets plan")?.status).toBe("warn");
      expect(byLabel(checks, "sops config parse")?.status).toBe("warn");
      expect(byLabel(checks, "GITHUB_TOKEN")?.detail).toContain("skipped");
    });
  });

  it("marks github token checks as warn when visibility probe is inconclusive", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
          },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: {
                provider: "hetzner",
                adminCidr: "10.0.0.0/24",
                sshPubkeyFile: "",
              },
              hetzner: {
                serverType: "cpx22",
              },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      tryGetOriginFlakeMock.mockResolvedValue("github:acme/repo");

      checkGithubRepoVisibilityMock.mockResolvedValueOnce({
        ok: false,
        status: "public",
      });
      const withTokenChecks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        githubToken: "ghp_test",
        push: (row) => withTokenChecks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });
      expect(byLabel(withTokenChecks, "GITHUB_TOKEN")?.status).toBe("warn");
      expect(byLabel(withTokenChecks, "GITHUB_TOKEN")?.detail).toContain("could not verify");

      checkGithubRepoVisibilityMock.mockResolvedValueOnce({
        ok: true,
        status: "unauthorized",
      });
      const noTokenChecks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        push: (row) => noTokenChecks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });
      expect(byLabel(noTokenChecks, "GITHUB_TOKEN")?.status).toBe("warn");
      expect(byLabel(noTokenChecks, "GITHUB_TOKEN")?.detail).toContain("unknown");
    });
  });

  it("covers bootstrap happy-path branches for hetzner persistence and secret verification", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      const hostSecretsDir = path.join(layout.secretsHostsDir, hostName);
      await mkdir(hostSecretsDir, { recursive: true });
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });

      const sshPubkeyFile = path.join(repoRoot, "id_ed25519.pub");
      const sopsAgeKeyFile = path.join(repoRoot, "operator.agekey");
      await writeFile(sshPubkeyFile, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey test@example\n", "utf8");
      await writeFile(sopsAgeKeyFile, "AGE-SECRET-KEY-1TEST\n", "utf8");
      await writeFile(path.join(hostSecretsDir, "admin_password_hash.yaml"), "admin_password_hash: ENC[x]\n", "utf8");
      await writeFile(path.join(hostSecretsDir, "discord_token.yaml"), "discord_token: ENC[y]\n", "utf8");
      await writeFile(layout.sopsConfigPath, "creation_rules: []\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
            sshAuthorizedKeys: [],
          },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: {
                provider: "hetzner",
                adminCidr: "10.0.0.0/24",
                sshPubkeyFile,
              },
              hetzner: {
                serverType: "cpx22",
                volumeSizeGb: 50,
                volumeLinuxDevice: "/dev/disk/by-id/scsi-0HC_Volume_abc",
              },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: ["gw1"],
              gateways: {
                gw1: {
                  openclaw: { memory: { backend: "qmd" } },
                  agents: { defaults: {} },
                },
              },
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: [],
        gateways: ["gw1"],
        hostSecretNamesRequired: ["admin_password_hash"],
        secretNamesAll: ["discord_token"],
        secretNamesRequired: ["admin_password_hash", "discord_token"],
      });
      sopsDecryptYamlFileMock.mockImplementation(async ({ filePath }: { filePath: string }) => {
        if (filePath.endsWith("admin_password_hash.yaml")) return "admin_password_hash: real-password-hash";
        return "discord_token: real-discord-token";
      });
      readYamlScalarFromMappingMock.mockImplementation(({ key }: { key: string }) => {
        if (key === "admin_password_hash") return "real-password-hash";
        return "real-discord-token";
      });
      agePublicKeyFromIdentityFileMock.mockResolvedValue("age1operator");
      getSopsCreationRuleAgeRecipientsMock.mockReturnValue(["age1operator"]);
      tryGetOriginFlakeMock.mockResolvedValue("/tmp/local-path");

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        hcloudToken: "hcloud-token",
        sopsAgeKeyFile,
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "qmd tooling")?.status).toBe("ok");
      expect(byLabel(checks, "hetzner.volumeLinuxDevice")?.status).toBe("ok");
      expect(byLabel(checks, "memory persistence")?.status).toBe("ok");
      expect(byLabel(checks, "provisioning ssh pubkey file")?.status).toBe("ok");
      expect(byLabel(checks, "secret value: admin_password_hash")?.status).toBe("ok");
      expect(byLabel(checks, "secret value: discord_token")?.status).toBe("ok");
    });
  });

  it("covers updates-scope warnings for missing host entries and target host", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";

      loadClawletsConfigMock.mockReturnValueOnce({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
          },
          hosts: {},
        },
      });
      const missingHostChecks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        push: (row) => missingHostChecks.push(row),
        fleetGateways: null,
        scope: "updates",
      });
      expect(byLabel(missingHostChecks, "host config")?.status).toBe("warn");

      loadClawletsConfigMock.mockReturnValueOnce({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
          },
          hosts: {
            [hostName]: {
              enable: true,
              targetHost: "",
              openclaw: { enable: true },
              provisioning: {
                provider: "hetzner",
                adminCidr: "10.0.0.0/24",
                sshPubkeyFile: "",
              },
              hetzner: {
                serverType: "cpx22",
              },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      const updatesChecks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        push: (row) => updatesChecks.push(row),
        fleetGateways: null,
        scope: "updates",
      });
      expect(byLabel(updatesChecks, "targetHost")?.status).toBe("warn");
    });
  });

  it("warns when operator public key derivation fails for sops recipients", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      const hostSecretsDir = path.join(layout.secretsHostsDir, hostName);
      await mkdir(hostSecretsDir, { recursive: true });
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });
      await writeFile(layout.sopsConfigPath, "creation_rules: []\n", "utf8");
      await writeFile(path.join(hostSecretsDir, "admin_password_hash.yaml"), "admin_password_hash: ENC[x]\n", "utf8");
      const sopsAgeKeyFile = path.join(repoRoot, "operator.agekey");
      await writeFile(sopsAgeKeyFile, "AGE-SECRET-KEY-1TEST\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: { backups: { restic: { enable: false } }, secretEnv: {} },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: { provider: "hetzner", adminCidr: "10.0.0.0/24", sshPubkeyFile: "" },
              hetzner: { serverType: "cpx22" },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: [],
        gateways: [],
        hostSecretNamesRequired: ["admin_password_hash"],
        secretNamesAll: [],
        secretNamesRequired: ["admin_password_hash"],
      });
      sopsDecryptYamlFileMock.mockResolvedValue("admin_password_hash: value");
      readYamlScalarFromMappingMock.mockReturnValue("value");
      agePublicKeyFromIdentityFileMock.mockRejectedValueOnce(new Error("age key parse failed"));
      tryGetOriginFlakeMock.mockResolvedValue("/tmp/local-path");

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        sopsAgeKeyFile,
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "sops recipients (operator key)")?.status).toBe("warn");
    });
  });

  it("covers sops creation-rule warning branches when suffix helpers throw", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      await mkdir(path.dirname(layout.sopsConfigPath), { recursive: true });
      await writeFile(layout.sopsConfigPath, "creation_rules: []\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: { backups: { restic: { enable: false } }, secretEnv: {} },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: { provider: "hetzner", adminCidr: "10.0.0.0/24", sshPubkeyFile: "" },
              hetzner: { serverType: "cpx22" },
              diskDevice: "/dev/sda",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });

      const hostSecretsSuffixSpy = vi
        .spyOn(sopsRules, "getHostSecretsSopsCreationRulePathSuffix")
        .mockImplementation(() => {
          throw new Error("host secrets suffix error");
        });
      const hostAgeSuffixSpy = vi
        .spyOn(sopsRules, "getHostAgeKeySopsCreationRulePathSuffix")
        .mockImplementation(() => {
          throw new Error("host age-key suffix error");
        });

      try {
        const checks: DoctorCheck[] = [];
        await addDeployChecks({
          cwd: repoRoot,
          repoRoot,
          layout,
          host: hostName,
          nixBin: "nix",
          push: (row) => checks.push(row),
          fleetGateways: null,
          scope: "bootstrap",
        });

        expect(byLabel(checks, "sops creation rule (host secrets)")?.status).toBe("warn");
        expect(byLabel(checks, "sops creation rule (host age key)")?.status).toBe("warn");
      } finally {
        hostSecretsSuffixSpy.mockRestore();
        hostAgeSuffixSpy.mockRestore();
      }
    });
  });

  it("covers placeholder disk-device, sshAuthorizedKeys, and fleet-secret overflow branches", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      const hostSecretsDir = path.join(layout.secretsHostsDir, hostName);
      await mkdir(hostSecretsDir, { recursive: true });

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: {
            backups: { restic: { enable: false } },
            secretEnv: {},
            sshAuthorizedKeys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest test@example"],
          },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: { provider: "hetzner", adminCidr: "10.0.0.0/24", sshPubkeyFile: "" },
              hetzner: { serverType: "cpx22" },
              diskDevice: "/dev/CHANGE_ME",
              tailnet: { mode: "tailscale" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: Array.from({ length: 11 }, (_, i) => ({
          kind: "envVar",
          gateway: "gw1",
          envVar: `TOKEN_${i}`,
        })),
        gateways: [],
        hostSecretNamesRequired: ["admin_password_hash"],
        secretNamesAll: [],
        secretNamesRequired: ["admin_password_hash"],
      });
      tryGetOriginFlakeMock.mockResolvedValue("/tmp/local-path");

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "diskDevice")?.status).toBe("missing");
      expect(String(byLabel(checks, "diskDevice")?.detail || "")).toContain("placeholder");
      expect(byLabel(checks, "fleet.sshAuthorizedKeys")?.status).toBe("ok");
      expect(
        checks.some(
          (row) => row.label === "fleet secrets" && String(row.detail || "").includes("(+1 more missing entries)"),
        ),
      ).toBe(true);
    });
  });

  it("covers local-operator key autodetect with aws non-default vpc and unset disk device", async () => {
    await withTempRepo(async (repoRoot) => {
      const layout = getRepoLayout(repoRoot);
      const hostName = "alpha";
      await mkdir(layout.localOperatorKeysDir, { recursive: true });
      await writeFile(path.join(layout.localOperatorKeysDir, "operator.agekey"), "AGE-SECRET-KEY-1TEST\n", "utf8");

      loadClawletsConfigMock.mockReturnValue({
        config: {
          defaultHost: hostName,
          fleet: { backups: { restic: { enable: false } }, secretEnv: {} },
          hosts: {
            [hostName]: {
              enable: true,
              openclaw: { enable: true },
              provisioning: { provider: "aws", adminCidr: "10.0.0.0/24", sshPubkeyFile: "" },
              aws: {
                region: "us-east-1",
                instanceType: "t3.large",
                amiId: "ami-0123456789abcdef0",
                useDefaultVpc: false,
                vpcId: "vpc-123",
                subnetId: "",
              },
              diskDevice: "",
              tailnet: { mode: "custom-tailnet" },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        },
      });
      buildFleetSecretsPlanMock.mockReturnValue({
        missingSecretConfig: [],
        gateways: [],
        hostSecretNamesRequired: ["admin_password_hash"],
        secretNamesAll: [],
        secretNamesRequired: ["admin_password_hash"],
      });

      const checks: DoctorCheck[] = [];
      await addDeployChecks({
        cwd: repoRoot,
        repoRoot,
        layout,
        host: hostName,
        nixBin: "nix",
        push: (row) => checks.push(row),
        fleetGateways: null,
        scope: "bootstrap",
      });

      expect(byLabel(checks, "SOPS_AGE_KEY_FILE")?.status).toBe("ok");
      expect(byLabel(checks, "tailnet configured")?.detail).toContain("unknown");
      expect(byLabel(checks, "aws.vpcId/subnetId")?.status).toBe("ok");
      expect(byLabel(checks, "diskDevice")?.status).toBe("missing");
      expect(String(byLabel(checks, "diskDevice")?.detail || "")).toContain("(unset");
    });
  });
});
