import process from "node:process";
import path from "node:path";
import { defineCommand } from "citty";
import { applySecurityDefaults } from "@clawlets/core/lib/config-patch";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { ClawletsConfigSchema, loadClawletsConfigRaw, writeClawletsConfig } from "@clawlets/core/lib/clawlets-config";

export const openclawHarden = defineCommand({
  meta: {
    name: "harden",
    description: "Apply safe OpenClaw security defaults to fleet/clawlets.json (opt-in).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    bot: { type: "string", description: "Only apply hardening to this bot id." },
    write: { type: "boolean", description: "Apply changes to fleet/clawlets.json.", default: false },
    json: { type: "boolean", description: "Output JSON summary.", default: false },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const validated = ClawletsConfigSchema.parse(raw);

    const botArg = String(args.bot || "").trim();
    const bots = botArg ? [botArg] : validated.fleet.botOrder || [];
    if (bots.length === 0) throw new Error("fleet.botOrder is empty (set bots in fleet/clawlets.json)");

    const next = structuredClone(validated) as any;

    const updates: Array<{
      bot: string;
      changes: Array<{ scope: "openclaw" | "channels"; path: string }>;
      warnings: string[];
    }> = [];

    for (const bot of bots) {
      const botId = String(bot || "").trim();
      if (!botId) continue;
      const existing = next?.fleet?.bots?.[botId];
      if (!existing || typeof existing !== "object") throw new Error(`unknown bot id: ${botId}`);

      const patched = applySecurityDefaults({ openclaw: (existing as any).openclaw, channels: (existing as any).channels });
      if (patched.changes.length === 0) continue;

      (existing as any).openclaw = patched.openclaw;
      (existing as any).channels = patched.channels;
      updates.push({
        bot: botId,
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
      for (const w of u.warnings) console.error(`warn: bot=${u.bot} ${w}`);
    }

    if (!args.write) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, write: false, updates }, null, 2));
        return;
      }
      console.log(`planned: update ${path.relative(repoRoot, configPath)}`);
      for (const u of updates) {
        for (const c of u.changes) console.log(`- fleet.bots.${u.bot}.${c.scope}.${c.path}`);
      }
      console.log("run with --write to apply changes");
      return;
    }

    const finalConfig = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: finalConfig });

    if (args.json) {
      console.log(JSON.stringify({ ok: true, write: true, updates }, null, 2));
      return;
    }

    console.log(`ok: updated ${path.relative(repoRoot, configPath)}`);
    for (const u of updates) {
      for (const c of u.changes) console.log(`- fleet.bots.${u.bot}.${c.scope}.${c.path}`);
    }
  },
});
