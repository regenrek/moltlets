import process from "node:process";
import { defineCommand } from "citty";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { ClawletsConfigSchema, loadClawletsConfig, writeClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import { coerceString, coerceTrimmedString } from "@clawlets/shared/lib/strings";

const show = defineCommand({
  meta: { name: "show", description: "Print fleet config (from fleet/clawlets.json)." },
  args: {},
  async run() {
    const repoRoot = findRepoRoot(process.cwd());
    const { config } = loadClawletsConfig({ repoRoot });
    console.log(JSON.stringify(config.fleet, null, 2));
  },
});

const set = defineCommand({
  meta: { name: "set", description: "Set fleet config fields (in fleet/clawlets.json)." },
  args: {
    "codex-enable": { type: "string", description: "Enable codex (true/false)." },
    "restic-enable": { type: "string", description: "Enable restic backups (true/false)." },
    "restic-repository": { type: "string", description: "Restic repository URL/path." },
  },
  async run({ args }) {
    const repoRoot = findRepoRoot(process.cwd());
    const { configPath, config } = loadClawletsConfig({ repoRoot });

    const next = structuredClone(config) as typeof config;

    const parseBool = (v: unknown): boolean | undefined => {
      if (v === undefined || v === null) return undefined;
      const s = coerceTrimmedString(v).toLowerCase();
      if (s === "") return undefined;
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
      throw new Error(`invalid boolean: ${coerceString(v)} (use true/false)`);
    };

    {
      const v = parseBool((args as any)["codex-enable"]);
      if (v !== undefined) next.fleet.codex.enable = v;
    }
    {
      const v = parseBool((args as any)["restic-enable"]);
      if (v !== undefined) next.fleet.backups.restic.enable = v;
    }

    if ((args as any)["restic-repository"] !== undefined) {
      next.fleet.backups.restic.repository = coerceTrimmedString((args as any)["restic-repository"]);
    }

    const validated = ClawletsConfigSchema.parse(next);
    await writeClawletsConfig({ configPath, config: validated });
    console.log("ok");
  },
});

export const fleet = defineCommand({
  meta: { name: "fleet", description: "Manage fleet config (fleet/clawlets.json)." },
  subCommands: { show, set },
});
