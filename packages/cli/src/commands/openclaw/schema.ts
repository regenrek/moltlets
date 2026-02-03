import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawlets/core/lib/ssh-remote";
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";
import { buildOpenClawGatewayConfig } from "@clawlets/core/lib/openclaw-config-invariants";
import { needsSudo, requireTargetHost } from "../server/common.js";

function requireGatewayId(value: string): string {
  const gatewayId = value.trim();
  const parsed = GatewayIdSchema.safeParse(gatewayId);
  if (!parsed.success) throw new Error(`invalid --gateway: ${gatewayId}`);
  return gatewayId;
}

function buildGatewaySchemaCommand(params: { gatewayId: string; port: number; sudo: boolean }): string {
  const envFile = `/srv/openclaw/${params.gatewayId}/credentials/gateway.env`;
  const url = `ws://127.0.0.1:${params.port}`;
  const envFileQuoted = shellQuote(envFile);
  const tokenName = "OPENCLAW_GATEWAY_TOKEN";
  const script = [
    "set -euo pipefail",
    `token=\"$(awk -F= '$1==\"${tokenName}\"{print substr($0,length($1)+2); exit}' ${envFileQuoted})\"`,
    'token="${token%$"\\r"}"',
    `if [ -z \"$token\" ]; then echo "missing ${tokenName}" >&2; exit 2; fi`,
    `env ${tokenName}=\"$token\" openclaw gateway call config.schema --url ${url} --json`,
  ].join(" && ");
  const args = [
    ...(params.sudo ? ["sudo", "-u", `gateway-${params.gatewayId}`] : []),
    "bash",
    "-lc",
    script,
  ];
  return args.map((a) => shellQuote(a)).join(" ");
}

const schemaFetch = defineCommand({
  meta: { name: "fetch", description: "Fetch live OpenClaw config schema via gateway RPC." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    gateway: { type: "string", description: "Gateway id (maps to systemd unit openclaw-<gateway>.service)." },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg, config } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);
    const gatewayId = requireGatewayId(String(args.gateway || ""));
    const gatewayConfig = buildOpenClawGatewayConfig({ config, gatewayId });
    const gateway = (gatewayConfig.invariants as any)?.gateway || {};
    const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`invalid gateway port for gateway ${gatewayId}`);
    }

    const remoteCmd = buildGatewaySchemaCommand({ gatewayId, port, sudo: needsSudo(targetHost) });
    await sshRun(targetHost, remoteCmd, { tty: Boolean(args.sshTty) });
  },
});

export const openclawSchema = defineCommand({
  meta: { name: "schema", description: "OpenClaw config schema helpers." },
  subCommands: {
    fetch: schemaFetch,
  },
});
