import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { applyOpenTofuVars } from "@clawdbot/clawdlets-core/lib/opentofu";
import { expandPath } from "@clawdbot/clawdlets-core/lib/path-expand";
import { loadStack, loadStackEnv } from "@clawdbot/clawdlets-core/stack";
import { requireStackHostOrExit, resolveHostNameOrExit } from "../lib/host-resolve.js";

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Hetzner OpenTofu for a host (public SSH toggle lives in server/lockdown).",
  },
  args: {
    stackDir: { type: "string", description: "Stack directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    "public-ssh": {
      type: "boolean",
      description: "Whether public SSH (22) is open in Hetzner firewall.",
      default: false,
    },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const { layout, stack } = loadStack({ cwd: process.cwd(), stackDir: args.stackDir });
    const hostName = resolveHostNameOrExit({ cwd: process.cwd(), stackDir: args.stackDir, hostArg: args.host });
    if (!hostName) return;
    const host = requireStackHostOrExit(stack, hostName);
    if (!host) return;

    const envLoaded = loadStackEnv({ cwd: process.cwd(), stackDir: args.stackDir, envFile: stack.envFile });
    const hcloudToken = String(envLoaded.env.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing HCLOUD_TOKEN (set it in stack env file)");

    const sshPubkeyFile = expandPath(host.opentofu.sshPubkeyFile);
    if (!fs.existsSync(sshPubkeyFile)) throw new Error(`ssh pubkey file not found: ${sshPubkeyFile}`);

    await applyOpenTofuVars({
      repoRoot: layout.repoRoot,
      vars: {
        hcloudToken,
        adminCidr: host.opentofu.adminCidr,
        sshPubkeyFile,
        serverType: host.hetzner.serverType,
        publicSsh: Boolean((args as any)["public-ssh"]),
      },
      nixBin: envLoaded.env.NIX_BIN || "nix",
      dryRun: args.dryRun,
      redact: [hcloudToken, envLoaded.env.GITHUB_TOKEN].filter(Boolean) as string[],
    });

    console.log(`ok: opentofu applied for ${hostName}`);
    console.log(`hint: outputs in ${path.join(layout.repoRoot, "infra", "opentofu")}`);
  },
});

export const infra = defineCommand({
  meta: {
    name: "infra",
    description: "Infrastructure operations (Hetzner OpenTofu).",
  },
  subCommands: {
    apply: infraApply,
  },
});
