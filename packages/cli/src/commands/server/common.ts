import { needsSudo, requireTargetHost } from "../ssh-target.js";
import type { ClawletsHostConfig } from "@clawlets/core/lib/clawlets-config";

export { needsSudo, requireTargetHost };

export function assertOpenclawEnabled(hostName: string, hostCfg: ClawletsHostConfig): void {
  if (hostCfg.openclaw?.enable) return;
  throw new Error(
    `openclaw disabled for host ${hostName} (set hosts.${hostName}.openclaw.enable=true after: clawlets secrets verify --scope openclaw)`,
  );
}
