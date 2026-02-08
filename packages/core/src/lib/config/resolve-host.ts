import { assertSafeHostName } from "@clawlets/shared/lib/identifiers";
import { coerceTrimmedString, formatUnknown } from "@clawlets/shared/lib/strings";
import type { ClawletsConfig, ClawletsHostConfig } from "./schema.js";
import type { SshExposureMode, TailnetMode } from "./schema-host.js";

export type ResolveHostNameResult =
  | { ok: true; host: string; source: "flag" | "defaultHost" | "soleHost" }
  | { ok: false; message: string; tips: string[]; availableHosts: string[] };

export function resolveHostName(params: { config: ClawletsConfig; host?: unknown }): ResolveHostNameResult {
  const availableHosts = Object.keys(params.config.hosts || {});
  const provided = coerceTrimmedString(params.host);

  if (provided) {
    try {
      assertSafeHostName(provided);
    } catch (e) {
      return {
        ok: false,
        message: formatUnknown(e),
        availableHosts,
        tips: [
          "host names must be safe identifiers (no spaces or shell metacharacters)",
          availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
          `use --host <name> to select a host`,
        ],
      };
    }
    if (params.config.hosts[provided]) {
      return { ok: true, host: provided, source: "flag" };
    }
    return {
      ok: false,
      message: `unknown host: ${provided}`,
      availableHosts,
      tips: [
        availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
        `use --host <name> to select a host`,
        `set defaultHost via: clawlets host set-default --host <name>`,
      ],
    };
  }

  if (params.config.defaultHost) {
    return { ok: true, host: params.config.defaultHost, source: "defaultHost" };
  }

  if (availableHosts.length === 1) {
    return { ok: true, host: availableHosts[0]!, source: "soleHost" };
  }

  return {
    ok: false,
    message: "missing host (multiple hosts configured)",
    availableHosts,
    tips: [
      `pass --host <name>`,
      `set defaultHost via: clawlets host set-default --host <name>`,
      availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
    ],
  };
}

export function getSshExposureMode(hostCfg: ClawletsHostConfig | null | undefined): SshExposureMode {
  const mode = hostCfg?.sshExposure?.mode;
  if (mode === "bootstrap" || mode === "public" || mode === "tailnet") return mode;
  return "tailnet";
}

export function isPublicSshExposure(mode: SshExposureMode): boolean {
  return mode === "bootstrap" || mode === "public";
}

export function getTailnetMode(hostCfg: ClawletsHostConfig | null | undefined): TailnetMode {
  const mode = hostCfg?.tailnet?.mode;
  if (mode === "tailscale" || mode === "none") return mode;
  return "none";
}
