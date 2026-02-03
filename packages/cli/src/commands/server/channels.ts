import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshRun } from "@clawlets/core/lib/ssh-remote";
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";
import { requireTargetHost, needsSudo } from "./common.js";

function requireGatewayId(value: string): string {
  const gatewayId = value.trim();
  const parsed = GatewayIdSchema.safeParse(gatewayId);
  if (!parsed.success) throw new Error(`invalid --gateway: ${gatewayId}`);
  return gatewayId;
}

function runRemoteOpenclawChannels(params: {
  targetHost: string;
  sudo: boolean;
  gatewayId: string;
  args: string[];
  sshTty: boolean;
}) {
  const remoteArgs = [
    ...(params.sudo ? ["sudo"] : []),
    "/etc/clawlets/bin/openclaw-channels",
    "--gateway",
    params.gatewayId,
    ...params.args,
  ];
  const remoteCmd = remoteArgs.map((a) => shellQuote(a)).join(" ");
  return sshRun(params.targetHost, remoteCmd, { tty: params.sshTty });
}

const serverChannelsStatus = defineCommand({
  meta: { name: "status", description: "Run `openclaw channels status` on the host for a gateway." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    gateway: { type: "string", description: "Gateway id (maps to systemd unit openclaw-<gateway>.service)." },
    probe: { type: "boolean", description: "Probe channel credentials.", default: false },
    timeout: { type: "string", description: "Timeout in ms.", default: "10000" },
    json: { type: "boolean", description: "Output JSON.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const gatewayId = requireGatewayId(String(args.gateway || ""));
    await runRemoteOpenclawChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      gatewayId,
      sshTty: Boolean(args.sshTty),
      args: [
        "status",
        ...(args.probe ? ["--probe"] : []),
        ...(args.timeout ? ["--timeout", String(args.timeout)] : []),
        ...(args.json ? ["--json"] : []),
      ],
    });
  },
});

const serverChannelsCapabilities = defineCommand({
  meta: { name: "capabilities", description: "Run `openclaw channels capabilities` on the host for a gateway." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    gateway: { type: "string", description: "Gateway id (maps to systemd unit openclaw-<gateway>.service)." },
    channel: { type: "string", description: "Channel id (discord|telegram|slack|whatsapp|...|all)." },
    account: { type: "string", description: "Account id (only with --channel)." },
    target: { type: "string", description: "Channel target for permission audit (Discord channel:<id>)." },
    timeout: { type: "string", description: "Timeout in ms.", default: "10000" },
    json: { type: "boolean", description: "Output JSON.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const gatewayId = requireGatewayId(String(args.gateway || ""));
    await runRemoteOpenclawChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      gatewayId,
      sshTty: Boolean(args.sshTty),
      args: [
        "capabilities",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
        ...(args.target ? ["--target", String(args.target)] : []),
        ...(args.timeout ? ["--timeout", String(args.timeout)] : []),
        ...(args.json ? ["--json"] : []),
      ],
    });
  },
});

const serverChannelsLogin = defineCommand({
  meta: { name: "login", description: "Run `openclaw channels login` on the host for a gateway." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    gateway: { type: "string", description: "Gateway id (maps to systemd unit openclaw-<gateway>.service)." },
    channel: { type: "string", description: "Channel alias (default: whatsapp)." },
    account: { type: "string", description: "Account id (accountId)." },
    verbose: { type: "boolean", description: "Verbose connection logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const gatewayId = requireGatewayId(String(args.gateway || ""));
    await runRemoteOpenclawChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      gatewayId,
      sshTty: Boolean(args.sshTty),
      args: [
        "login",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
        ...(args.verbose ? ["--verbose"] : []),
      ],
    });
  },
});

const serverChannelsLogout = defineCommand({
  meta: { name: "logout", description: "Run `openclaw channels logout` on the host for a gateway." },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    gateway: { type: "string", description: "Gateway id (maps to systemd unit openclaw-<gateway>.service)." },
    channel: { type: "string", description: "Channel alias (default: whatsapp)." },
    account: { type: "string", description: "Account id (accountId)." },
    sshTty: { type: "boolean", description: "Allocate SSH TTY.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const gatewayId = requireGatewayId(String(args.gateway || ""));
    await runRemoteOpenclawChannels({
      targetHost,
      sudo: needsSudo(targetHost),
      gatewayId,
      sshTty: Boolean(args.sshTty),
      args: [
        "logout",
        ...(args.channel ? ["--channel", String(args.channel)] : []),
        ...(args.account ? ["--account", String(args.account)] : []),
      ],
    });
  },
});

export const serverChannels = defineCommand({
  meta: { name: "channels", description: "Operate OpenClaw channels over SSH (status/login/logout/capabilities)." },
  subCommands: {
    status: serverChannelsStatus,
    capabilities: serverChannelsCapabilities,
    login: serverChannelsLogin,
    logout: serverChannelsLogout,
  },
});
