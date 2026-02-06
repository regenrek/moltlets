import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix/nix-flakes";

const NIX_EVAL_TIMEOUT_MS = 240_000;

function resolveRepoRoot(): string {
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

describe("fleet nix eval", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "returns empty gateways when openclaw is disabled/missing",
    async () => {
      const repoRoot = resolveRepoRoot();
      const expr = [
        "let",
        "  flake = builtins.getFlake (toString ./.);",
        "  lib = flake.inputs.nixpkgs.lib;",
        "  infraConfig = { schemaVersion = 2; hosts = { alpha = { enable = true; }; }; fleet = { secretEnv = {}; secretFiles = {}; sshAuthorizedKeys = []; sshKnownHosts = []; backups = { restic = { enable = false; repository = \"\"; }; }; }; cattle = { enabled = false; }; };",
        "  openclawConfig = { schemaVersion = 1; hosts = {}; fleet = { secretEnv = {}; secretFiles = {}; gatewayArchitecture = \"multi\"; codex = { enable = false; gateways = []; }; }; };",
        "  project = {",
        "    root = flake.outPath;",
        "    infraConfig = infraConfig;",
        "    openclawConfig = openclawConfig;",
        "    config = infraConfig;",
        "  };",
        "  hostName = \"alpha\";",
        "  fleetConfigPath =",
        "    let",
        "      modernPath = flake.outPath + \"/nix/lib/fleet-config.nix\";",
        "      openclawPath = flake.outPath + \"/nix/openclaw/infra/lib/fleet-config.nix\";",
        "      legacyPath = flake.outPath + \"/nix/infra/lib/fleet-config.nix\";",
        "    in if builtins.pathExists modernPath then modernPath",
        "    else if builtins.pathExists openclawPath then openclawPath",
        "    else if builtins.pathExists legacyPath then legacyPath",
        "    else throw \"fleet-config.nix not found\";",
        "  fleet = import fleetConfigPath { inherit lib project hostName; };",
        "in fleet.gateways",
      ].join("\n");

      const out = execFileSync("nix", ["eval", "--impure", "--json", "--expr", expr], {
        cwd: repoRoot,
        env: withFlakesEnv(process.env),
        stdio: "pipe",
      }).toString("utf8");
      expect(JSON.parse(out)).toEqual([]);
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
