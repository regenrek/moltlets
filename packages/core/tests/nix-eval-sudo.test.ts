import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function hasNix(): boolean {
  try {
    execFileSync("nix", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function evalSudoExtraConfig(deployEnabled: boolean): string {
  const expr = `
let
  flake = builtins.getFlake (toString ./.);
  system = "x86_64-linux";
  hostName = "clawdbot-fleet-host";
  pkgs = import flake.inputs.nixpkgs { inherit system; };
  cfg = (pkgs.lib.nixosSystem {
    inherit system;
    specialArgs = {
      inherit (flake.inputs) nix-clawdbot;
      flakeInfo = { clawdlets = { rev = null; lastModifiedDate = null; }; };
    };
    modules = [
      flake.inputs.disko.nixosModules.disko
      flake.inputs.nixos-generators.nixosModules.all-formats
      flake.inputs.sops-nix.nixosModules.sops
      ./infra/nix/modules/clawdlets-host-meta.nix
      ({ ... }: { clawdlets.hostName = hostName; })
      ./infra/disko/example.nix
      ./infra/nix/modules/clawdlets-image-formats.nix
      ./infra/nix/hosts/clawdlets-host.nix
      ({ ... }: { clawdlets.operator.deploy.enable = ${deployEnabled ? "true" : "false"}; })
    ];
  }).config;
in cfg.security.sudo.extraConfig
`;

  return execFileSync("nix", ["eval", "--impure", "--raw", "--expr", expr], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  }).trim();
}

describe("sudo deploy allowlist", () => {
  const testIt = hasNix() ? it : it.skip;

  testIt("omits deploy sudo alias when disabled", () => {
    const extra = evalSudoExtraConfig(false);
    expect(extra).not.toContain("CLAWDLETS_DEPLOY");
  });

  testIt("includes deploy sudo alias when enabled", () => {
    const extra = evalSudoExtraConfig(true);
    expect(extra).toContain("CLAWDLETS_DEPLOY");
  });
});
