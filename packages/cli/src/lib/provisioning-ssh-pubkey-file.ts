import fs from "node:fs";
import path from "node:path";
import type { RepoLayout } from "@clawlets/core/repo-layout";
import { expandPath } from "@clawlets/core/lib/path-expand";
import { normalizeSshPublicKey } from "@clawlets/core/lib/ssh";
import type { ClawletsConfig } from "@clawlets/core/lib/clawlets-config";

/**
 * Resolve the public key file used for provisioning/OpenTofu.
 *
 * Canonical input is `fleet.sshAuthorizedKeys` (project-scoped) so this works
 * even when the dashboard is remote. If the fleet has no keys, we fall back to
 * `hosts.<host>.provisioning.sshPubkeyFile` (local path on the bootstrap machine).
 */
export function resolveProvisioningSshPubkeyFile(params: {
  repoRoot: string;
  layout: RepoLayout;
  config: ClawletsConfig;
  hostName: string;
}): { sshPubkeyFile: string; source: "fleet" | "hostPath" } {
  const hostCfg = params.config.hosts[params.hostName];
  if (!hostCfg) throw new Error(`missing host in fleet/clawlets.json: ${params.hostName}`);

  const fleetKeys = Array.isArray((params.config as any).fleet?.sshAuthorizedKeys)
    ? ((params.config as any).fleet.sshAuthorizedKeys as string[]).map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  if (fleetKeys.length > 0) {
    const normalized = normalizeSshPublicKey(fleetKeys[0]!);
    const outDir = path.join(params.layout.localKeysDir, "provisioning");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${params.hostName}.pub`);
    fs.writeFileSync(outFile, `${normalized}\n`, { encoding: "utf8", mode: 0o600 });
    return { sshPubkeyFile: outFile, source: "fleet" };
  }

  const raw = String((hostCfg as any).provisioning?.sshPubkeyFile || "").trim();
  if (!raw) {
    throw new Error(
      `missing SSH public key for ${params.hostName} (add one via: clawlets host set --add-ssh-key ... or Security → SSH Keys; or set hosts.${params.hostName}.provisioning.sshPubkeyFile to a local .pub path on the bootstrap machine)`,
    );
  }

  const expanded = expandPath(raw);
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(params.repoRoot, expanded);
  if (!fs.existsSync(abs)) throw new Error(`ssh pubkey file not found: ${abs}`);
  return { sshPubkeyFile: abs, source: "hostPath" };
}

