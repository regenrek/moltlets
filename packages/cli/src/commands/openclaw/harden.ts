import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { applySecurityDefaults } from "@clawlets/core/lib/config/config-patch";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { ClawletsConfigSchema, loadFullConfig, resolveHostName, writeClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";

export const openclawHarden = defineCommand({
  meta: {
    name: "harden",
    description: "Apply safe OpenClaw security defaults to fleet/openclaw.json (opt-in).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    gateway: { type: "string", description: "Only apply hardening to this gateway id." },
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json + fleet/openclaw.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { infraConfigPath, openclawConfigPath, config } = loadFullConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const writeTargets = `${path.relative(repoRoot, infraConfigPath)} + ${path.relative(repoRoot, openclawConfigPath)}`;
    const validated = ClawletsConfigSchema.parse(config);

    const resolved = resolveHostName({ config: validated, host: args.host });
    if (!resolved.ok) {
      const tips = resolved.tips.length > 0 ? `; ${resolved.tips.join("; ")}` : "";
      throw new Error(`${resolved.message}${tips}`);
    }
    const hostCfg = (validated.hosts as any)?.[resolved.host];
    if (!hostCfg) throw new Error(`missing host in config.hosts: ${resolved.host}`);

    const gatewayArg = String(args.gateway || "").trim();
    const gateways = gatewayArg ? [gatewayArg] : hostCfg.gatewaysOrder || [];
    if (gateways.length === 0) {
      throw new Error(`hosts.${resolved.host}.gatewaysOrder is empty (set gateways in fleet/openclaw.json)`);
    }

    const next = structuredClone(validated) as any;

    const updates: Array<{
      gatewayId: string;
      changes: Array<{ scope: "openclaw" | "channels"; path: string }>;
      warnings: string[];
    }> = [];

    for (const gatewayIdRaw of gateways) {
      const gatewayId = String(gatewayIdRaw || "").trim();
      if (!gatewayId) continue;
      const existing = next?.hosts?.[resolved.host]?.gateways?.[gatewayId];
      if (!existing || typeof existing !== "object") throw new Error(`unknown gateway id: ${gatewayId}`);

      const patched = applySecurityDefaults({ openclaw: (existing as any).openclaw, channels: (existing as any).channels });
      if (patched.changes.length === 0) continue;

      (existing as any).openclaw = patched.openclaw;
      (existing as any).channels = patched.channels;
      updates.push({
        gatewayId,
        changes: patched.changes,
        warnings: patched.warnings,
      });
    }

    if (updates.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: Boolean(args.write), updates: [] }, null, 2));
      } else {
        console.log("ok: no security hardening changes needed");
      }
      return;
    }

    for (const u of updates) {
      for (const w of u.warnings) console.error(`warn: host=${resolved.host} gateway=${u.gatewayId} ${w}`);
    }

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates }, null, 2));
        return;
      }
      console.log(`planned: update ${writeTargets}`);
      for (const u of updates) {
        for (const c of u.changes) console.log(`- hosts.${resolved.host}.gateways.${u.gatewayId}.${c.scope}.${c.path}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const finalConfig = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath: infraConfigPath, config: finalConfig });

    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }

    console.log(`ok: updated ${writeTargets}`);
    for (const u of updates) {
      for (const c of u.changes) console.log(`- hosts.${resolved.host}.gateways.${u.gatewayId}.${c.scope}.${c.path}`);
    }
  },
});
