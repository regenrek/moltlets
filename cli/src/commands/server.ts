import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawdbot/clawdlets-core/lib/git";
import { shellQuote, sshCapture, sshRun } from "@clawdbot/clawdlets-core/lib/ssh-remote";
import { resolveBaseFlake } from "@clawdbot/clawdlets-core/lib/base-flake";
import { requireTargetHost, needsSudo } from "./server/common.js";
import { serverGithubSync } from "./server/github-sync.js";
import { loadHostContextOrExit } from "../lib/context.js";

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

function normalizeClawdbotUnit(value: string): string {
  const v = value.trim();
  if (v === "clawdbot-*.service") return v;
  if (/^clawdbot-[A-Za-z0-9._-]+$/.test(v)) return `${v}.service`;
  if (/^clawdbot-[A-Za-z0-9._-]+\.service$/.test(v)) return v;
  throw new Error(`invalid --unit: ${v} (expected clawdbot-<id>[.service] or clawdbot-*.service)`);
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

function resolveHostFromFlake(flakeBase: string): string | null {
  const hashIndex = flakeBase.indexOf("#");
  if (hashIndex === -1) return null;
  const host = flakeBase.slice(hashIndex + 1).trim();
  return host.length > 0 ? host : null;
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
    description: "Audit host invariants over SSH (tailscale, clawdbot services).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
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
    const bots = config.fleet.bots ?? [];

    const checks: AuditCheck[] = [];
    const add = (c: AuditCheck) => checks.push(c);

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

    if (Array.isArray(bots) && bots.length > 0) {
      add({ status: "ok", label: "fleet bots list", detail: bots.join(", ") });
    } else {
      add({ status: "warn", label: "fleet bots list", detail: "(empty)" });
    }

    for (const bot of bots) {
      const unit = normalizeClawdbotUnit(`clawdbot-${String(bot).trim()}`);
      const show = await must(`systemctl show ${unit}`, [ ...(sudo ? ["sudo"] : []), "systemctl", "show", shellQuote(unit) ].join(" "));
      if (!show) continue;
      const parsed = parseSystemctlShow(show);
      const loadState = parsed.LoadState || "";
      const activeState = parsed.ActiveState || "";
      const subState = parsed.SubState || "";

      if (loadState && loadState !== "loaded") {
        add({ status: "missing", label: `${unit} load state`, detail: `LoadState=${loadState}` });
      } else if (activeState === "active" && subState === "running") {
        add({ status: "ok", label: `${unit} state`, detail: `${activeState}/${subState}` });
      } else {
        add({ status: "missing", label: `${unit} state`, detail: `${activeState || "?"}/${subState || "?"}` });
      }
    }

    if (args.json) console.log(JSON.stringify({ host: hostName, targetHost, checks }, null, 2));
    else for (const c of checks) console.log(`${c.status}: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);

    if (checks.some((c) => c.status === "missing")) process.exitCode = 1;
  },
});

const serverStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show systemd status for Clawdbot services.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
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
      "clawdbot-*.service",
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
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    unit: {
      type: "string",
      description: "systemd unit (default: clawdbot-*.service).",
      default: "clawdbot-*.service",
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
    const unit = normalizeClawdbotUnit(String(args.unit || "clawdbot-*.service"));
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

const serverRebuild = defineCommand({
  meta: {
    name: "rebuild",
    description: "Run nixos-rebuild switch on the host using a pinned git rev/ref.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    flake: { type: "string", description: "Flake base override (default: clawdlets.json baseFlake or git origin)." },
    rev: { type: "string", description: "Git rev to pin (HEAD/sha/tag).", default: "HEAD" },
    ref: { type: "string", description: "Git ref to pin (branch or tag)." },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, repoRoot, config, hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const githubToken = String(process.env.GITHUB_TOKEN || "").trim();

    const rev = String(args.rev || "").trim();
    const ref = String(args.ref || "").trim();
    if (rev && ref) throw new Error("use either --rev or --ref (not both)");

    const sudo = needsSudo(targetHost);
    if (sudo) {
      if (ref) throw new Error("ref rebuild is not supported over constrained sudo; use --rev <sha|HEAD>");
      if (String(args.flake || "").trim()) throw new Error("flake override is not supported over constrained sudo; set clawdlets.operator.rebuild.flakeBase instead");
      if (githubToken) throw new Error("GITHUB_TOKEN rebuild is not supported over constrained sudo; use a trusted workstation rebuild for private repos");

      const resolved = await resolveGitRev(layout.repoRoot, rev || "HEAD");
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev || "HEAD"}`);
      const remoteCmd = ["sudo", "/etc/clawdlets/bin/rebuild-host", "--rev", resolved].map(shellQuote).join(" ");
      await sshRun(targetHost, remoteCmd, { tty: sudo && args.sshTty });
      return;
    }

    const baseResolved = await resolveBaseFlake({ repoRoot, config });
    const flakeBase = String(args.flake || baseResolved.flake || "").trim();
    if (!flakeBase) throw new Error("missing base flake (set baseFlake in infra/configs/clawdlets.json, set git origin, or pass --flake)");

    const requestedHost = String(hostCfg.flakeHost || hostName).trim() || hostName;
    const hostFromFlake = resolveHostFromFlake(flakeBase);
    if (hostFromFlake && hostFromFlake !== requestedHost) {
      throw new Error(`flake host mismatch: ${hostFromFlake} vs ${requestedHost}`);
    }
    const flakeWithHost = flakeBase.includes("#") ? flakeBase : `${flakeBase}#${requestedHost}`;

    const hashIndex = flakeWithHost.indexOf("#");
    const flakeBasePath = hashIndex === -1 ? flakeWithHost : flakeWithHost.slice(0, hashIndex);
    const flakeFragment = hashIndex === -1 ? "" : flakeWithHost.slice(hashIndex);
    if ((rev || ref) && /(^|[?&])(rev|ref)=/.test(flakeBasePath)) {
      throw new Error("flake already includes ?rev/?ref; drop --rev/--ref");
    }

    let flake = flakeWithHost;
    if (rev) {
      const resolved = await resolveGitRev(layout.repoRoot, rev);
      if (!resolved) throw new Error(`unable to resolve git rev: ${rev}`);
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}rev=${resolved}${flakeFragment}`;
    } else if (ref) {
      const sep = flakeBasePath.includes("?") ? "&" : "?";
      flake = `${flakeBasePath}${sep}ref=${ref}${flakeFragment}`;
    }

    const remoteArgs: string[] = ["env"];
    if (githubToken) {
      remoteArgs.push(`NIX_CONFIG=access-tokens = github.com=${githubToken}`);
    }
    remoteArgs.push("nixos-rebuild", "switch", "--flake", flake);

    const remoteCmd = remoteArgs.map(shellQuote).join(" ");
    await sshRun(targetHost, remoteCmd, { tty: false });
  },
});

const serverRestart = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a systemd unit (default: clawdbot-*.service).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawdlets)." },
    host: { type: "string", description: "Host name (defaults to clawdlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawdlets.json)." },
    unit: { type: "string", description: "systemd unit (default: clawdbot-*.service).", default: "clawdbot-*.service" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const unit = String(args.unit || "clawdbot-*.service").trim() || "clawdbot-*.service";
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
    description: "Server operations via SSH (rebuild/logs/status).",
  },
  subCommands: {
    audit: serverAudit,
    status: serverStatus,
    logs: serverLogs,
    "github-sync": serverGithubSync,
    restart: serverRestart,
    rebuild: serverRebuild,
  },
});
