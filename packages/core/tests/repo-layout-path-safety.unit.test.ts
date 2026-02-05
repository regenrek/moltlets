import { describe, it, expect } from "vitest";
import path from "node:path";

describe("repo-layout path safety", () => {
  it("rejects unsafe host segments in host path helpers", async () => {
    const { getRepoLayout, getHostSecretsDir, getHostExtraFilesDir } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/repo/.clawlets");
    expect(() => getHostSecretsDir(layout, "../pwn")).toThrow(/invalid host name/i);
    expect(() => getHostExtraFilesDir(layout, "../pwn")).toThrow(/invalid host name/i);
  });

  it("rejects unsafe gateway ids in getGatewayWorkspaceDir", async () => {
    const { getRepoLayout, getGatewayWorkspaceDir } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/repo/.clawlets");
    expect(() => getGatewayWorkspaceDir(layout, "../pwn")).toThrow(/invalid gateway id/i);
    expect(() => getGatewayWorkspaceDir(layout, "A")).toThrow(/invalid gateway id/i);
  });

  it("rejects unsafe secret names in getHostSecretFile", async () => {
    const { getRepoLayout, getHostSecretFile } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/repo/.clawlets");
    expect(() => getHostSecretFile(layout, "openclaw-fleet-host", "../pwn")).toThrow(/invalid secret name/i);
  });

  it("builds expected paths for valid inputs", async () => {
    const { getRepoLayout, getGatewayWorkspaceDir, getHostSecretsDir, getHostSecretFile, getHostExtraFilesKeyPath } = await import("../src/repo-layout.js");
    const layout = getRepoLayout("/repo", "/repo/.clawlets");

    expect(getHostSecretsDir(layout, "openclaw-fleet-host")).toBe(path.join("/repo", "secrets", "hosts", "openclaw-fleet-host"));
    expect(getHostSecretFile(layout, "openclaw-fleet-host", "admin_password_hash")).toBe(
      path.join("/repo", "secrets", "hosts", "openclaw-fleet-host", "admin_password_hash.yaml"),
    );
    expect(getHostExtraFilesKeyPath(layout, "openclaw-fleet-host")).toBe(
      path.join("/repo", ".clawlets", "extra-files", "openclaw-fleet-host", "var", "lib", "sops-nix", "key.txt"),
    );
    expect(getGatewayWorkspaceDir(layout, "maren")).toBe(path.join("/repo", "fleet", "workspaces", "gateways", "maren"));
  });
});
