import path from "node:path";
import { z } from "zod";
import { capture } from "./run.js";
import type { FleetConfig } from "./fleet-policy.js";
import { withFlakesEnv } from "./nix-flakes.js";

const FleetConfigSchema = z.object({
  bots: z.array(z.string()).default([]),
  botProfiles: z.record(z.any()).default({}),
});

function safeRelPath(repoRoot: string, absPath: string): string {
  const rel = path.relative(repoRoot, absPath).replace(/\\/g, "/");
  if (rel.startsWith("../") || rel === "..") throw new Error(`path escapes repo: ${absPath}`);
  return rel;
}

export async function evalFleetConfig(params: {
  repoRoot: string;
  fleetFilePath: string;
  nixBin: string;
}): Promise<FleetConfig> {
  const repoRoot = params.repoRoot;
  const abs = path.isAbsolute(params.fleetFilePath)
    ? params.fleetFilePath
    : path.resolve(repoRoot, params.fleetFilePath);
  const rel = safeRelPath(repoRoot, abs);
  // Pure evaluation forbids reading arbitrary local absolute paths.
  // Import from the flake source path (store) instead.
  const expr = [
    "let",
    "  flake = builtins.getFlake (toString ./.);",
    "  lib = flake.inputs.nixpkgs.lib;",
    `  fleet = import (flake.outPath + "/${rel}") { inherit lib; };`,
    "in fleet",
  ].join("\n");

  const out = await capture(params.nixBin, ["eval", "--impure", "--json", "--expr", expr], {
    cwd: repoRoot,
    env: withFlakesEnv(process.env),
  });

  const parsed = FleetConfigSchema.safeParse(JSON.parse(out));
  if (!parsed.success) {
    throw new Error(`invalid fleet JSON (${rel}): ${parsed.error.message}`);
  }
  return parsed.data as FleetConfig;
}
