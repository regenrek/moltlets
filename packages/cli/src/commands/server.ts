import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshCapture, sshRun } from "@clawlets/core/lib/ssh-remote";
import { mapWithConcurrency } from "@clawlets/core/lib/concurrency";
import { requireTargetHost, needsSudo } from "./server/common.js";
import { serverGithubSync } from "./server/github-sync.js";
import { serverChannels } from "./server/channels.js";
import { serverUpdate } from "./server/update.js";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";

function normalizeSince(value: string): string {
  const v = value.trim();
  const m = v.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return v;
  const n = Number(m[1]);
  const unit = String(m[2]).toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return v;
  if (unit === "s") return `${n} sec ago`;
  if (unit === "m") return `${n} min ago`;
  if (unit === "h") return `${n} hour ago`;
  if (unit === "d") return `${n} day ago`;
  return v;
}

function normalizeOpenclawUnit(value: string): string {
  const v = value.trim();
  if (v === "openclaw-*.service") return v;
  if (/^openclaw-[A-Za-z0-9._-]+$/.test(v)) return `${v}.service`;
  if (/^openclaw-[A-Za-z0-9._-]+\.service$/.test(v)) return v;
  throw new Error(`invalid --unit: ${v} (expected openclaw-<id>[.service] or openclaw-*.service)`);
}

function parseSystemctlShow(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    if (key in out) continue;
    out[key] = line.slice(idx + 1);
  }
  return out;
}

type AuditCheck = { status: "ok" | "warn" | "missing"; label: string; detail?: string };

async function trySshCapture(targetHost: string, remoteCmd: string, opts: { tty?: boolean } = {}): Promise<{ ok: boolean; out: string }> {
  try {
    const out = await sshCapture(targetHost, remoteCmd, opts);
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as Error)?.message || e) };
  }
}

const serverAudit = defineCommand({
  meta: {
    name: "audit",
    description: "Audit host invariants over SSH (tailscale, openclaw services).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { config, hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const openclawEnabled = Boolean(hostCfg.openclaw?.enable);
    const configuredGateways = hostCfg.gatewaysOrder ?? [];
    const gateways = openclawEnabled ? configuredGateways : [];

    const checks: AuditCheck[] = [];
    const add = (c: AuditCheck) => checks.push(c);
    const openclawSecurityAudit: Record<string, unknown> = {};

    const must = async (label: string, cmd: string): Promise<string | null> => {
      const out = await trySshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
      if (!out.ok) {
        add({ status: "missing", label, detail: out.out });
        return null;
      }
      return out.out;
    };

    if (hostCfg.tailnet?.mode === "tailscale") {
      const tailscaled = await must(
        "tailscale service",
        [ ...(sudo ? ["sudo"] : []), "systemctl", "show", "tailscaled.service" ].join(" "),
      );
      if (tailscaled) {
        const parsed = parseSystemctlShow(tailscaled);
        add({
          status: parsed.ActiveState === "active" ? "ok" : "missing",
          label: "tailscale service state",
          detail: `${parsed.ActiveState || "?"}/${parsed.SubState || "?"}`,
        });
      }

      const autoconnect = await must(
        "tailscale autoconnect",
        [ ...(sudo ? ["sudo"] : []), "systemctl", "show", "tailscaled-autoconnect.service" ].join(" "),
      );
      if (autoconnect) {
        const parsed = parseSystemctlShow(autoconnect);
        add({
          status: parsed.ActiveState === "active" ? "ok" : "missing",
          label: "tailscale autoconnect state",
          detail: `${parsed.ActiveState || "?"}/${parsed.SubState || "?"}`,
        });
      }
    }

    if (!openclawEnabled) {
      add({
        status: "warn",
        label: "openclaw enable",
        detail: `disabled (set hosts.${hostName}.openclaw.enable=true after secrets verify --scope openclaw)`,
      });
    }

    if (Array.isArray(configuredGateways) && configuredGateways.length > 0) {
      add({ status: "ok", label: `host gateways list (${hostName})`, detail: configuredGateways.join(", ") });
    } else {
      add({ status: "warn", label: `host gateways list (${hostName})`, detail: "(empty)" });
    }

    const gatewayChecks = await mapWithConcurrency({
      items: gateways,
      concurrency: 4,
      fn: async (gateway) => {
        const out: AuditCheck[] = [];

        const mustBot = async (label: string, cmd: string): Promise<string | null> => {
          const captured = await trySshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
          if (!captured.ok) {
            out.push({ status: "missing", label, detail: captured.out });
            return null;
          }
          return captured.out;
        };

        const gatewayId = String(gateway).trim();
        const unit = normalizeOpenclawUnit(`openclaw-${gatewayId}`);

        const show = await mustBot(
          `systemctl show ${unit}`,
          [ ...(sudo ? ["sudo"] : []), "systemctl", "show", shellQuote(unit) ].join(" "),
        );
        if (show) {
          const parsed = parseSystemctlShow(show);
          const loadState = parsed.LoadState || "";
          const activeState = parsed.ActiveState || "";
          const subState = parsed.SubState || "";

          if (loadState && loadState !== "loaded") {
            out.push({ status: "missing", label: `${unit} load state`, detail: `LoadState=${loadState}` });
          } else if (activeState === "active" && subState === "running") {
            out.push({ status: "ok", label: `${unit} state`, detail: `${activeState}/${subState}` });
          } else {
            out.push({ status: "missing", label: `${unit} state`, detail: `${activeState || "?"}/${subState || "?"}` });
          }
        }

        const channelsStatus = await mustBot(
          `channels status (${gatewayId})`,
          [
            ...(sudo ? ["sudo"] : []),
            "/etc/clawlets/bin/openclaw-channels",
            "--gateway",
            shellQuote(gatewayId),
            "status",
            "--json",
          ].join(" "),
        );
        if (channelsStatus) out.push({ status: "ok", label: `channels status (${gatewayId})` });

        {
          const stateDir = `/srv/openclaw/${gatewayId}`;
          const configPath = `/run/secrets/rendered/openclaw-${gatewayId}.json`;
          const user = `gateway-${gatewayId}`;
          const cmd = [
            "sudo",
            "-u",
            shellQuote(user),
            "env",
            `OPENCLAW_NIX_MODE=1`,
            `OPENCLAW_STATE_DIR=${shellQuote(stateDir)}`,
            `OPENCLAW_CONFIG_PATH=${shellQuote(configPath)}`,
            "openclaw",
            "security",
            "audit",
            "--json",
          ].join(" ");

          const captured = await trySshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
          if (!captured.ok) {
            openclawSecurityAudit[gatewayId] = { error: captured.out };
            out.push({ status: "warn", label: `openclaw security audit (${gatewayId})`, detail: captured.out });
          } else {
            const raw = captured.out;
            try {
              const parsed = JSON.parse(raw);
              openclawSecurityAudit[gatewayId] = parsed;

              const summary = parsed?.summary;
              const critical = Number(summary?.critical ?? 0);
              const warn = Number(summary?.warn ?? 0);
              const info = Number(summary?.info ?? 0);
              const status: AuditCheck["status"] = critical > 0 ? "missing" : warn > 0 ? "warn" : "ok";
              out.push({
                status,
                label: `openclaw security audit (${gatewayId})`,
                detail: `critical=${Number.isFinite(critical) ? critical : "?"} warn=${Number.isFinite(warn) ? warn : "?"} info=${Number.isFinite(info) ? info : "?"}`,
              });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              openclawSecurityAudit[gatewayId] = { error: "invalid_json", message, raw };
              out.push({ status: "warn", label: `openclaw security audit (${gatewayId})`, detail: `invalid json: ${message}` });
            }
          }
        }

        return out;
      },
    });

    for (const list of gatewayChecks) {
      for (const c of list) add(c);
    }

    if (args.json) console.log(JSON.stringify({ host: hostName, targetHost, checks, openclawSecurityAudit }, null, 2));
    else for (const c of checks) console.log(`${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;
  },
});

const serverStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show systemd status for OpenClaw services.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const cmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "list-units",
      "openclaw-*.service",
      "--no-pager",
    ].join(" ");
    const out = await sshCapture(targetHost, cmd, { tty: sudo && args.sshTty });
    console.log(out);
  },
});

const serverLogs = defineCommand({
  meta: {
    name: "logs",
    description: "Stream or print logs via journalctl.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    unit: {
      type: "string",
      description: "systemd unit (default: openclaw-*.service).",
      default: "openclaw-*.service",
    },
    lines: { type: "string", description: "Number of lines (default: 200).", default: "200" },
    since: { type: "string", description: "Time window (supports 5m/1h/2d or journalctl syntax)." },
    follow: { type: "boolean", description: "Follow logs.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const sudo = needsSudo(targetHost);
    const unit = normalizeOpenclawUnit(String(args.unit || "openclaw-*.service"));
    const since = args.since ? normalizeSince(String(args.since)) : "";
    const n = String(args.lines || "200").trim() || "200";
    if (!/^\d+$/.test(n) || Number(n) <= 0) throw new Error(`invalid --lines: ${n}`);

    const cmdArgs = [
      ...(sudo ? ["sudo"] : []),
      "journalctl",
      "-u",
      shellQuote(unit),
      "-n",
      shellQuote(n),
      ...(since ? ["--since", shellQuote(since)] : []),
      ...(args.follow ? ["-f"] : []),
      "--no-pager",
    ];
    const remoteCmd = cmdArgs.join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

const serverRestart = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a systemd unit (default: openclaw-*.service).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    unit: { type: "string", description: "systemd unit (default: openclaw-*.service).", default: "openclaw-*.service" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const unit = String(args.unit || "openclaw-*.service").trim() || "openclaw-*.service";
    const sudo = needsSudo(targetHost);
    const remoteCmd = [
      ...(sudo ? ["sudo"] : []),
      "systemctl",
      "restart",
      shellQuote(unit),
    ].join(" ");
    await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
  },
});

export const server = defineCommand({
  meta: {
    name: "server",
    description: "Server operations via SSH (audit/logs/status/update).",
  },
  subCommands: {
    audit: serverAudit,
    channels: serverChannels,
    status: serverStatus,
    logs: serverLogs,
    "github-sync": serverGithubSync,
    restart: serverRestart,
    update: serverUpdate,
  },
});
