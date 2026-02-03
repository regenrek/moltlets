import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withFlakesEnv } from "../src/lib/nix-flakes";

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

describe("openclaw fleet tmpfiles", () => {
  const testIt = hasNix() && fs.existsSync(resolveRepoRoot()) ? it : it.skip;

  testIt(
    "creates stateDirBase and per-gateway dirs via tmpfiles",
    () => {
      const repoRoot = resolveRepoRoot();
      const fixtureRoot = "./packages/core/tests/fixtures/project";

      const expr = [
        "let",
        "  flake = builtins.getFlake (toString ./.);",
        "  system = \"x86_64-linux\";",
        "  nixpkgs = flake.inputs.nixpkgs;",
        "  lib = nixpkgs.lib;",
        "  project = { root = toString " + fixtureRoot + "; config = {}; };",
        "  cfg = (lib.nixosSystem {",
        "    inherit system;",
        "    specialArgs = { inherit project; flakeInfo = { clawlets = { rev = \"test\"; lastModifiedDate = null; }; }; };",
        "    modules = [",
        "      flake.inputs.sops-nix.nixosModules.sops",
        "      flake.nixosModules.openclawFleet",
        "      ({ ... }: { system.stateVersion = \"25.11\"; networking.hostName = \"test-host\"; })",
        "      ({ ... }: {",
        "        services.openclawFleet.enable = true;",
        "        services.openclawFleet.gateways = [ \"maren\" \"sonja\" ];",
        "        services.openclawFleet.gatewayProfiles.maren.skills.allowBundled = [ ];",
        "        services.openclawFleet.gatewayProfiles.sonja.skills.allowBundled = [ ];",
        "      })",
        "    ];",
        "  }).config;",
        "in {",
        "  rules = cfg.systemd.tmpfiles.rules;",
        "  botHomes = {",
        "    maren = cfg.users.users.\"gateway-maren\".home;",
        "    sonja = cfg.users.users.\"gateway-sonja\".home;",
        "  };",
        "}",
      ].join("\n");

      const raw = execFileSync("nix", ["eval", "--impure", "--json", "--expr", expr], {
        cwd: repoRoot,
        env: withFlakesEnv(process.env),
        stdio: "pipe",
        encoding: "utf8",
      });

      const out = JSON.parse(raw) as { rules: string[]; botHomes: Record<string, string> };

      expect(out.rules).toContain("d /srv/openclaw 0755 root root - -");
      expect(out.rules).toContain("d /srv/openclaw/maren 0700 gateway-maren gateway-maren - -");
      expect(out.rules).toContain("d /srv/openclaw/maren/credentials 0700 gateway-maren gateway-maren - -");

      expect(out.botHomes.maren).toBe("/srv/openclaw/maren");
      expect(out.botHomes.sonja).toBe("/srv/openclaw/sonja");
      expect(out.botHomes.maren).not.toBe(out.botHomes.sonja);
    },
    NIX_EVAL_TIMEOUT_MS,
  );
});
