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
    "  project = {",
    "    root = flake.outPath;",
    "    config = builtins.fromJSON (builtins.readFile (flake.outPath + \"/fleet/clawlets.json\"));",
    "  };",
    `  hostName = ${JSON.stringify(hostName)};`,
    "  fleet = import (flake.inputs.clawlets.outPath + \"/nix/infra/lib/fleet-config.nix\") { inherit lib project hostName; };",
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
