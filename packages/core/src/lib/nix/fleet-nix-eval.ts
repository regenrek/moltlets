import { z } from "zod";
import { capture } from "../runtime/index.js";
import type { FleetConfig } from "../config/index.js";
import { withFlakesEnv } from "./nix-flakes.js";

const FleetConfigSchema = z.object({
  gateways: z.array(z.string()).default([]),
  gatewayProfiles: z.record(z.string(), z.any()).default(() => ({})),
});

export async function evalFleetConfig(params: {
  repoRoot: string;
  nixBin: string;
  hostName: string;
}): Promise<FleetConfig> {
  const hostName = String(params.hostName || "").trim();
  if (!hostName) throw new Error("hostName is required for fleet config eval");
  const expr = [
    "let",
    "  flake = builtins.getFlake (toString ./.);",
    "  lib = flake.inputs.clawlets.inputs.nixpkgs.lib;",
    "  infraConfig = builtins.fromJSON (builtins.readFile (flake.outPath + \"/fleet/clawlets.json\"));",
    "  openclawConfig =",
    "    if builtins.pathExists (flake.outPath + \"/fleet/openclaw.json\")",
    "    then builtins.fromJSON (builtins.readFile (flake.outPath + \"/fleet/openclaw.json\"))",
    "    else { schemaVersion = 1; hosts = {}; fleet = {}; };",
    "  project = {",
    "    root = flake.outPath;",
    "    infraConfig = infraConfig;",
    "    openclawConfig = openclawConfig;",
    "    config = infraConfig;",
    "  };",
    `  hostName = ${JSON.stringify(hostName)};`,
    "  fleetConfigPath =",
    "    let",
    "      modernPath = flake.inputs.clawlets.outPath + \"/nix/lib/fleet-config.nix\";",
    "      openclawPath = flake.inputs.clawlets.outPath + \"/nix/openclaw/infra/lib/fleet-config.nix\";",
    "      legacyPath = flake.inputs.clawlets.outPath + \"/nix/infra/lib/fleet-config.nix\";",
    "    in if builtins.pathExists modernPath then modernPath",
    "    else if builtins.pathExists openclawPath then openclawPath",
    "    else if builtins.pathExists legacyPath then legacyPath",
    "    else throw \"fleet-config.nix not found in clawlets input\";",
    "  fleet = import fleetConfigPath { inherit lib project hostName; };",
    "in {",
    "  gateways = fleet.gateways;",
    "  gatewayProfiles = fleet.gatewayProfiles;",
    "}",
  ].join("\n");

  const out = await capture(params.nixBin, ["eval", "--impure", "--json", "--expr", expr], {
    cwd: params.repoRoot,
    env: withFlakesEnv(process.env),
  });

  const parsed = FleetConfigSchema.safeParse(JSON.parse(out));
  if (!parsed.success) {
    throw new Error(`invalid fleet JSON (nix eval): ${parsed.error.message}`);
  }
  return parsed.data as FleetConfig;
}
