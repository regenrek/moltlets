import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawlets/core/lib/security/ssh-remote";
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";
import { buildOpenClawGatewayConfig } from "@clawlets/core/lib/openclaw/config-invariants";
import { compareOpenclawSchemaToNixOpenclaw, summarizeOpenclawSchemaComparison } from "@clawlets/core/lib/openclaw/schema/compare";
import { fetchNixOpenclawSourceInfo, getNixOpenclawRevFromFlakeLock } from "@clawlets/core/lib/nix/nix-openclaw-source";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { needsSudo, requireTargetHost } from "./server/common.js";

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
    `token="$(awk -F= '$1=="${tokenName}"{print substr($0,length($1)+2); exit}' ${envFileQuoted})"`,
    'token="${token%$"\\r"}"',
    `if [ -z "$token" ]; then echo "missing ${tokenName}" >&2; exit 2; fi`,
    `env ${tokenName}="$token" openclaw gateway call config.schema --url ${url} --json`,
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
    const gatewayConfig = buildOpenClawGatewayConfig({ config, hostName, gatewayId });
    const gateway = (gatewayConfig.invariants as any)?.gateway || {};
    const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`invalid gateway port for gateway ${gatewayId}`);
    }

    const remoteCmd = buildGatewaySchemaCommand({ gatewayId, port, sudo: needsSudo(targetHost) });
    await sshRun(targetHost, remoteCmd, { tty: Boolean(args.sshTty) });
  },
});

const schemaStatus = defineCommand({
  meta: { name: "status", description: "Compare pinned OpenClaw schema with nix-openclaw revisions." },
  args: {
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    type SchemaStatusOutput = {
      ok: true
      pinned?: { nixOpenclawRev: string; openclawRev: string }
      upstream?: { nixOpenclawRef: string; openclawRev: string }
      warnings?: string[]
    }

    const repoRoot = findRepoRoot(process.cwd());
    const comparison = await compareOpenclawSchemaToNixOpenclaw({
      repoRoot,
      fetchNixOpenclawSourceInfo,
      getNixOpenclawRevFromFlakeLock,
      requireSchemaRev: false,
    });

    const result: SchemaStatusOutput = !comparison
      ? {
          ok: true as const,
          warnings: ["openclaw schema revision unavailable"],
        }
      : (() => {
          const summary = summarizeOpenclawSchemaComparison(comparison);
          const pinned = summary.pinned?.ok
            ? { nixOpenclawRev: summary.pinned.nixOpenclawRev, openclawRev: summary.pinned.openclawRev }
            : undefined;
          const upstream = summary.upstream.ok
            ? { nixOpenclawRef: summary.upstream.nixOpenclawRef, openclawRev: summary.upstream.openclawRev }
            : undefined;
          return {
            ok: true as const,
            pinned,
            upstream,
            warnings: summary.warnings.length > 0 ? summary.warnings : undefined,
          };
        })();

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.pinned) {
      console.log(`pinned: nix=${result.pinned.nixOpenclawRev} openclaw=${result.pinned.openclawRev}`);
    } else {
      console.log("pinned: unavailable");
    }
    if (result.upstream) {
      console.log(`upstream: ref=${result.upstream.nixOpenclawRef} openclaw=${result.upstream.openclawRev}`);
    } else {
      console.log("upstream: unavailable");
    }
    for (const warning of result.warnings || []) console.log(`warn: ${warning}`);
  },
});

export const openclawSchema = defineCommand({
  meta: { name: "schema", description: "OpenClaw config schema helpers." },
  subCommands: {
    fetch: schemaFetch,
    status: schemaStatus,
  },
});
