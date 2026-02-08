import fs from "node:fs";
import process from "node:process";
import { defineCommand } from "citty";
import { run } from "@clawlets/core/lib/runtime/run";
import { shellQuote, sshRun } from "@clawlets/core/lib/security/ssh-remote";
import { getHostRemoteSecretsDir, getHostSecretsDir } from "@clawlets/core/repo-layout";
import { resolveGitRev } from "@clawlets/core/lib/vcs/git";
import { createSecretsTar } from "@clawlets/core/lib/secrets/secrets-tar";
import { needsSudo, requireTargetHost } from "./common.js";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";

export const secretsSync = defineCommand({
  meta: {
    name: "sync",
    description: "Copy local secrets to the server via the install-secrets allowlist.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    targetHost: { type: "string", description: "SSH target override (default: from clawlets.json)." },
    rev: { type: "string", description: "Git rev for secrets metadata (HEAD/sha/tag).", default: "HEAD" },
    sshTty: { type: "boolean", description: "Allocate TTY for sudo prompts.", default: true },
    previewJson: { type: "boolean", description: "Emit preview JSON and exit without SSH upload.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { layout, hostName, hostCfg } = ctx;

    const targetHost = requireTargetHost(String(args.targetHost || hostCfg.targetHost || ""), hostName);

    const localDir = getHostSecretsDir(layout, hostName);
    const remoteDir = getHostRemoteSecretsDir(hostName);
    const created = await createSecretsTar({ hostName, localDir });
    const tarLocal = created.tarPath;
    const digest = created.digest;
    if (args.previewJson) {
      try {
        console.log(JSON.stringify({ ok: true, localDir, remoteDir, digest, files: created.files }));
      } finally {
        try {
          if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
        } catch {
          // best-effort cleanup
        }
      }
      return;
    }
    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(layout.repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);

    const tarRemote = `/tmp/clawlets-secrets.${hostName}.${process.pid}.tgz`;

    try {
      await run("scp", [tarLocal, `${targetHost}:${tarRemote}`], { redact: [] });
    } finally {
      try {
        if (fs.existsSync(tarLocal)) fs.unlinkSync(tarLocal);
      } catch {
        // best-effort cleanup
      }
    }

    const sudo = needsSudo(targetHost);
    const installCmd = [
      ...(sudo ? ["sudo"] : []),
      "/etc/clawlets/bin/install-secrets",
      "--host",
      hostName,
      "--tar",
      tarRemote,
      "--rev",
      resolved,
      "--digest",
      digest,
    ].map(shellQuote).join(" ");
    await sshRun(targetHost, installCmd, { tty: sudo && args.sshTty });

    console.log(`ok: synced secrets to ${remoteDir}`);
  },
});
