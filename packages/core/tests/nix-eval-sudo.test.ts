import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix-flakes";

const NIX_EVAL_TIMEOUT_MS = 240_000;

function resolveRepoRoot(): string {
  return path.resolve(process.env.CLAWLETS_TEMPLATE_DIR || path.join(__dirname, ".template"));
}

function resolveClawletsRepoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

function hasNix(): boolean {
  try {
    execFileSync("nix", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function evalSudoExtraConfig(deployEnabled: boolean): string {
  const clawletsRepo = resolveClawletsRepoRoot();
  const clawletsRef = JSON.stringify(`path:${clawletsRepo}`);
  const expr = `
let
  baseFlake = builtins.getFlake (toString ./.);
  clawlets = builtins.getFlake ${clawletsRef};
  flake = baseFlake // { inputs = baseFlake.inputs // { clawlets = clawlets; }; };
  system = "x86_64-linux";
  hostName = "openclaw-fleet-host";
  nixpkgs = flake.inputs.clawlets.inputs.nixpkgs;
  lib = nixpkgs.lib;
  project = {
    root = flake.outPath;
    config = builtins.fromJSON (builtins.readFile (flake.outPath + "/fleet/clawlets.json"));
  };
  cfg = (lib.nixosSystem {
    inherit system;
    specialArgs = {
      clawlets = flake.inputs.clawlets;
      nix-clawdbot = flake.inputs.clawlets.inputs.nix-clawdbot;
      inherit project;
      flakeInfo = { clawlets = { rev = null; lastModifiedDate = null; }; };
    };
    modules = [
      flake.inputs.clawlets.inputs.disko.nixosModules.disko
      flake.inputs.clawlets.inputs.nixos-generators.nixosModules.all-formats
      flake.inputs.clawlets.inputs.sops-nix.nixosModules.sops
      flake.inputs.clawlets.nixosModules.clawletsProjectHost
      ({ ... }: { clawlets.hostName = hostName; })
      ({ ... }: { clawlets.operator.deploy.enable = lib.mkForce ${deployEnabled ? "true" : "false"}; })
    ];
  }).config;
in cfg.security.sudo.extraConfig
`;

  return execFileSync(
    "nix",
    ["eval", "--impure", "--raw", "--expr", expr],
    {
      cwd: resolveRepoRoot(),
      env: withFlakesEnv(process.env),
      encoding: "utf8",
    },
  ).trim();
}

describe("sudo deploy allowlist", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "omits deploy sudo alias when disabled",
    () => {
      const extra = evalSudoExtraConfig(false);
      expect(extra).not.toContain("CLAWLETS_DEPLOY");
    },
    NIX_EVAL_TIMEOUT_MS,
  );

  testIt(
    "includes deploy sudo alias when enabled",
    () => {
      const extra = evalSudoExtraConfig(true);
      expect(extra).toContain("CLAWLETS_DEPLOY");
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
