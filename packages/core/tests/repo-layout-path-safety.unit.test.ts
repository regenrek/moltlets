import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const savedClawletsHome = process.env.CLAWLETS_HOME;

afterEach(() => {
  if (savedClawletsHome === undefined) delete process.env.CLAWLETS_HOME;
  else process.env.CLAWLETS_HOME = savedClawletsHome;
});

describe("repo-layout path safety", () => {
  it("builds default runtime dir under CLAWLETS_HOME/workspaces/<repo>-<hash>", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-repo-"));
    const clawletsHome = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-home-"));
    process.env.CLAWLETS_HOME = clawletsHome;

    const repoRootReal = fs.realpathSync(path.resolve(repoRoot));
    const repoName = path.basename(repoRootReal).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "repo";
    const repoHash = createHash("sha256").update(repoRootReal, "utf8").digest("hex").slice(0, 16);
    const expectedRuntimeDir = path.join(clawletsHome, "workspaces", `${repoName}-${repoHash}`);

    const layout = getRepoLayout(repoRoot);
    expect(layout.runtimeDir).toBe(expectedRuntimeDir);
    expect(layout.envFilePath).toBe(path.join(expectedRuntimeDir, "env"));
  });

  it("resolves default runtime dir without creating CLAWLETS_HOME", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-pure-repo-"));
    const homeParent = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-pure-home-parent-"));
    const clawletsHome = path.join(homeParent, "clawlets-home-not-created");
    process.env.CLAWLETS_HOME = clawletsHome;

    expect(fs.existsSync(clawletsHome)).toBe(false);
    getRepoLayout(repoRoot);
    expect(fs.existsSync(clawletsHome)).toBe(false);
  });

  it("rejects default runtime when CLAWLETS_HOME is inside repoRoot", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-home-inside-"));
    process.env.CLAWLETS_HOME = path.join(repoRoot, ".runtime-home");
    expect(() => getRepoLayout(repoRoot)).toThrow(/runtime contains secrets\/state; must be outside repoRoot/i);
  });

  it("rejects default runtime when CLAWLETS_HOME symlink parent resolves into repoRoot", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-home-link-repo-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-home-link-outside-"));
    const symlinkHome = path.join(outside, "home-link");
    fs.symlinkSync(repoRoot, symlinkHome);
    process.env.CLAWLETS_HOME = symlinkHome;
    expect(() => getRepoLayout(repoRoot)).toThrow(/runtime contains secrets\/state; must be outside repoRoot/i);
  });

  it("rejects explicit runtimeDir under repoRoot", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-runtime-inside-"));
    expect(() => getRepoLayout(repoRoot, path.join(repoRoot, "runtime"))).toThrow(/runtime contains secrets\/state; must be outside repoRoot/i);
  });

  it("rejects explicit runtimeDir that resolves into repoRoot via symlink", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-realpath-repo-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-realpath-outside-"));
    const repoRuntimeDir = path.join(repoRoot, "runtime-real");
    fs.mkdirSync(repoRuntimeDir, { recursive: true });

    const symlinkRoot = path.join(outside, "link-to-repo");
    fs.symlinkSync(repoRoot, symlinkRoot);
    const escapedRuntimeDir = path.join(symlinkRoot, "runtime-real");

    expect(() => getRepoLayout(repoRoot, escapedRuntimeDir)).toThrow(/runtime contains secrets\/state; must be outside repoRoot/i);
  });

  it("rejects explicit runtimeDir when symlink parent resolves into repoRoot and leaf does not exist", async () => {
    const { getRepoLayout } = await import("../src/repo-layout.js");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-realpath-missing-repo-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-repo-layout-realpath-missing-outside-"));
    const symlinkRoot = path.join(outside, "link-to-repo");
    fs.symlinkSync(repoRoot, symlinkRoot);
    const escapedRuntimeDir = path.join(symlinkRoot, "runtime-not-yet-created");

    expect(() => getRepoLayout(repoRoot, escapedRuntimeDir)).toThrow(/runtime contains secrets\/state; must be outside repoRoot/i);
  });

  it("enforces private runtime dir permissions on POSIX", async () => {
    const { ensurePrivateRuntimeDir } = await import("../src/repo-layout.js");
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-private-runtime-"));
    fs.chmodSync(runtimeDir, 0o755);
    ensurePrivateRuntimeDir(runtimeDir);
    if (process.platform === "win32") return;
    const mode = fs.statSync(runtimeDir).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it("rejects symlink runtime dir without changing target mode", async () => {
    if (process.platform === "win32") return;
    const { ensurePrivateRuntimeDir } = await import("../src/repo-layout.js");
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-private-runtime-symlink-"));
    const targetDir = path.join(parentDir, "runtime-target");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.chmodSync(targetDir, 0o755);
    const runtimeLink = path.join(parentDir, "runtime-link");
    fs.symlinkSync(targetDir, runtimeLink);

    expect(() => ensurePrivateRuntimeDir(runtimeLink)).toThrow(/must not be a symlink/i);
    const mode = fs.statSync(targetDir).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("rejects unsafe host segments in host path helpers", async () => {
    const { getRepoLayout, getHostSecretsDir, getHostExtraFilesDir } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/tmp/clawlets-runtime");
    expect(() => getHostSecretsDir(layout, "../pwn")).toThrow(/invalid host name/i);
    expect(() => getHostExtraFilesDir(layout, "../pwn")).toThrow(/invalid host name/i);
  });

  it("rejects unsafe gateway ids in getGatewayWorkspaceDir", async () => {
    const { getRepoLayout, getGatewayWorkspaceDir } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/tmp/clawlets-runtime");
    expect(() => getGatewayWorkspaceDir(layout, "../pwn")).toThrow(/invalid gateway id/i);
    expect(() => getGatewayWorkspaceDir(layout, "A")).toThrow(/invalid gateway id/i);
  });

  it("rejects unsafe secret names in getHostSecretFile", async () => {
    const { getRepoLayout, getHostSecretFile } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/tmp/clawlets-runtime");
    expect(() => getHostSecretFile(layout, "openclaw-fleet-host", "../pwn")).toThrow(/invalid secret name/i);
  });

  it("builds expected paths for valid inputs", async () => {
    const {
      getRepoLayout,
      getGatewayWorkspaceDir,
      getHostSecretsDir,
      getHostSecretFile,
      getHostExtraFilesKeyPath,
      getHostScopedOperatorAgeKeyPath,
    } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/tmp/clawlets-runtime");

    expect(getHostSecretsDir(layout, "openclaw-fleet-host")).toBe(path.join("/repo", "secrets", "hosts", "openclaw-fleet-host"));
    expect(getHostSecretFile(layout, "openclaw-fleet-host", "admin_password_hash")).toBe(
      path.join("/repo", "secrets", "hosts", "openclaw-fleet-host", "admin_password_hash.yaml"),
    );
    expect(getHostExtraFilesKeyPath(layout, "openclaw-fleet-host")).toBe(
      path.join("/tmp/clawlets-runtime", "extra-files", "openclaw-fleet-host", "var", "lib", "sops-nix", "key.txt"),
    );
    expect(getHostScopedOperatorAgeKeyPath(layout, "openclaw-fleet-host", "tester")).toBe(
      path.join("/tmp/clawlets-runtime", "keys", "operators", "hosts", "openclaw-fleet-host", "tester.agekey"),
    );
    expect(getGatewayWorkspaceDir(layout, "maren")).toBe(path.join("/repo", "fleet", "workspaces", "gateways", "maren"));
  });
});
