import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix/nix-flakes";

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

describe("sudo policy (host)", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "does not allow wildcard nixos-rebuild flake rebuilds in sudoers",
    () => {
      const repoRoot = resolveRepoRoot();
      const clawletsRepo = resolveClawletsRepoRoot();
      const clawletsRef = JSON.stringify(`path:${clawletsRepo}`);
      const cfgPath = path.join(repoRoot, "fleet", "clawlets.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as any;
      const host = Object.keys((cfg && typeof cfg === "object" ? (cfg as any).hosts : null) || {})[0] || "openclaw-fleet-host";

      const expr = `
let
  baseFlake = builtins.getFlake (toString ./.);
  clawlets = builtins.getFlake ${clawletsRef};
  flake = baseFlake // { inputs = baseFlake.inputs // { clawlets = clawlets; }; };
  system = "x86_64-linux";
  hostName = ${JSON.stringify(host)};
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
      nix-openclaw-source = flake.inputs.clawlets.inputs.nix-openclaw-source;
      inherit project;
      flakeInfo = { clawlets = { rev = null; lastModifiedDate = null; }; };
    };
    modules = [
      flake.inputs.clawlets.inputs.disko.nixosModules.disko
      flake.inputs.clawlets.inputs.nixos-generators.nixosModules.all-formats
      flake.inputs.clawlets.inputs.sops-nix.nixosModules.sops
      flake.inputs.clawlets.nixosModules.clawletsProjectHost
      ({ ... }: { clawlets.hostName = hostName; })
    ];
  }).config;
in cfg.security.sudo.extraConfig
`;

      const extra = execFileSync(
        "nix",
        ["eval", "--impure", "--raw", "--expr", expr],
        {
          cwd: repoRoot,
          env: withFlakesEnv(process.env),
          encoding: "utf8",
        },
      ).trim();

      expect(extra.includes("--flake *")).toBe(false);
      expect(/Cmnd_Alias\s+CLAWDBOT_REBUILD\b/.test(extra)).toBe(false);
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
