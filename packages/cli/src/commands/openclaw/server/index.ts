import process from "node:process";
import { defineCommand } from "citty";
import { shellQuote, sshCapture, sshRun } from "@clawlets/core/lib/security/ssh-remote";
import { mapWithConcurrency } from "@clawlets/core/lib/runtime/concurrency";
import { extractFirstIpv4, isTailscaleIpv4, normalizeSingleLineOutput } from "@clawlets/core/lib/host/host-connectivity";
import { requireTargetHost, needsSudo } from "./common.js";
import { serverGithubSync } from "./github-sync.js";
import { serverChannels } from "./channels.js";
import { serverUpdate } from "./update.js";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";

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

function parseDurationToMs(raw: string): number | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (/^[0-9]+$/.test(v)) {
    const parsed = Number.parseInt(v, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    if (parsed > 3_600_000) return null;
    return parsed;
  }
  const m = v.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = String(m[2]).toLowerCase();
  const seconds =
    unit === "s" ? n :
    unit === "m" ? n * 60 :
    unit === "h" ? n * 60 * 60 :
    unit === "d" ? n * 60 * 60 * 24 :
    null;
  if (seconds == null) return null;
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms > 3_600_000) return null;
  return ms;
}

function parseMs(raw: string): number | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (!/^[0-9]+$/.test(v)) return null;
  const parsed = Number.parseInt(v, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > 120_000) return null;
  return parsed;
}

async function probeTailscaleIpv4(params: { targetHost: string }): Promise<string> {
  const raw = await sshCapture(params.targetHost, "ip -4 addr show dev tailscale0 2>/dev/null || true", {
    tty: false,
    timeoutMs: 15_000,
    maxOutputBytes: 8 * 1024,
  });
  const normalized = normalizeSingleLineOutput(raw || "");
  const ipv4 = extractFirstIpv4(normalized || raw || "");
  if (!ipv4) throw new Error("tailscale ip missing");
  if (!isTailscaleIpv4(ipv4)) throw new Error(`unexpected IPv4 ${ipv4}`);
  return ipv4;
}

async function waitForTailscaleIpv4(params: { targetHost: string; timeoutMs: number; pollMs: number }): Promise<string> {
  const startedAt = Date.now();
  let lastError = "tailscale ip missing";
  const deadline = startedAt + Math.max(1, params.timeoutMs);

  while (Date.now() < deadline) {
    try {
      const ipv4 = await probeTailscaleIpv4({ targetHost: params.targetHost });
      return ipv4;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, params.pollMs)));
  }

  const waited = Math.max(0, Date.now() - startedAt);
  throw new Error(`timed out waiting for tailscale ipv4 after ${waited}ms (last error: ${lastError || "unknown"})`);
}

async function probeSshHostname(params: { targetHost: string; timeoutMs: number }): Promise<string> {
  const raw = await sshCapture(params.targetHost, "hostname", {
    tty: false,
    timeoutMs: params.timeoutMs,
    maxOutputBytes: 2 * 1024,
  });
  return normalizeSingleLineOutput(raw || "");
}

async function waitForSshHostname(params: { targetHost: string; timeoutMs: number; pollMs: number; attemptTimeoutMs: number }): Promise<string> {
  const startedAt = Date.now();
  let lastError = "ssh unreachable";
  const deadline = startedAt + Math.max(1, params.timeoutMs);

  while (Date.now() < deadline) {
    try {
      return await probeSshHostname({ targetHost: params.targetHost, timeoutMs: params.attemptTimeoutMs });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, params.pollMs)));
  }

  const waited = Math.max(0, Date.now() - startedAt);
  throw new Error(`timed out waiting for ssh after ${waited}ms (last error: ${lastError || "unknown"})`);
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
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
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
        detail: `disabled (set fleet/openclaw.json hosts.${hostName}.enable=true after secrets verify --scope openclaw)`,
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
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
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
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
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
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
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

const serverTailscaleIpv4 = defineCommand({
  meta: {
    name: "tailscale-ipv4",
    description: "Probe tailscale IPv4 over SSH.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
    wait: { type: "boolean", description: "Retry until tailscale IPv4 appears.", default: false },
    waitTimeout: { type: "string", description: "Max wait duration (duration or milliseconds).", default: "10m" },
    waitPollMs: { type: "string", description: "Poll interval in ms.", default: "5000" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const wait = Boolean(args.wait)
    const waitTimeout = wait ? parseDurationToMs(String((args as any).waitTimeout || "10m")) : null
    const waitPollMs = wait ? parseMs(String((args as any).waitPollMs || "5000")) : null;
    if (wait) {
      if (waitTimeout == null) {
        throw new Error(`invalid --wait-timeout: ${String((args as any).waitTimeout)}`);
      }
      if (waitPollMs == null) {
        throw new Error(`invalid --wait-poll-ms: ${String((args as any).waitPollMs)}`);
      }
    }

    const ipv4 = wait
      ? await waitForTailscaleIpv4({
          targetHost,
          timeoutMs: waitTimeout as number,
          pollMs: waitPollMs as number,
        })
      : await probeTailscaleIpv4({ targetHost });

    if (args.json) {
      console.log(JSON.stringify({ ok: true, ipv4 }, null, 2));
      return;
    }
    console.log(ipv4);
  },
});

const serverSshCheck = defineCommand({
  meta: {
    name: "ssh-check",
    description: "Verify SSH reachability and return hostname.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    wait: { type: "boolean", description: "Retry until SSH is reachable.", default: false },
    waitTimeout: { type: "string", description: "Max wait duration (duration or milliseconds).", default: "5m" },
    waitPollMs: { type: "string", description: "Poll interval in ms.", default: "5000" },
    json: { type: "boolean", description: "Output JSON.", default: false },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const attemptTimeoutMs = 8_000;
    const wait = Boolean(args.wait);
    const waitTimeout = wait ? parseDurationToMs(String((args as any).waitTimeout || "5m")) : null;
    const waitPollMs = wait ? parseMs(String((args as any).waitPollMs || "5000")) : null;
    if (wait) {
      if (waitTimeout == null) {
        throw new Error(`invalid --wait-timeout: ${String((args as any).waitTimeout)}`);
      }
      if (waitPollMs == null) {
        throw new Error(`invalid --wait-poll-ms: ${String((args as any).waitPollMs)}`);
      }
    }

    const hostname = wait
      ? await waitForSshHostname({
          targetHost,
          timeoutMs: waitTimeout as number,
          pollMs: waitPollMs as number,
          attemptTimeoutMs,
        })
      : await probeSshHostname({ targetHost, timeoutMs: attemptTimeoutMs });

    if (args.json) {
      console.log(JSON.stringify({ ok: true, hostname: hostname || null }, null, 2));
      return;
    }
    if (hostname) console.log(hostname);
    else console.log("ok");
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
    "tailscale-ipv4": serverTailscaleIpv4,
    "ssh-check": serverSshCheck,
    update: serverUpdate,
  },
});
