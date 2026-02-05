import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { loadDeployCreds } from "@clawlets/core/lib/deploy-creds";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { loadClawletsConfig } from "@clawlets/core/lib/clawlets-config";
import { getHostOpenTofuDir } from "@clawlets/core/repo-layout";
import { resolveHostNameOrExit } from "@clawlets/core/lib/host-resolve";
import { buildHostProvisionSpec, getProvisionerDriver } from "@clawlets/core/lib/infra";

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply provisioning for a host (driven by fleet/clawlets.json).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const { layout, config: clawletsConfig } = loadClawletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const hostCfg = clawletsConfig.hosts[hostName];
    if (!hostCfg) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const opentofuDir = getHostOpenTofuDir(layout, hostName);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg });
    const driver = getProvisionerDriver(spec.provider);
    const runtime = {
      repoRoot,
      opentofuDir,
      nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
      dryRun: args.dryRun,
      redact: [deployCreds.values.HCLOUD_TOKEN, deployCreds.values.GITHUB_TOKEN].filter(Boolean) as string[],
      credentials: {
        hcloudToken: deployCreds.values.HCLOUD_TOKEN,
        githubToken: deployCreds.values.GITHUB_TOKEN,
      },
    };

    const provisioned = await driver.provision({ spec, runtime });
    const providerStateDir = path.join(opentofuDir, "providers", spec.provider);

    console.log(`ok: provisioning applied for ${hostName}`);
    if (provisioned.instanceId) console.log(`instanceId: ${provisioned.instanceId}`);
    if (provisioned.ipv4) console.log(`ipv4: ${provisioned.ipv4}`);
    console.log(`hint: outputs in ${providerStateDir}`);
  },
});

const infraDestroy = defineCommand({
  meta: {
    name: "destroy",
    description: "Destroy provisioned resources for a host (DANGEROUS).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    force: { type: "boolean", description: "Skip confirmation prompt (non-interactive).", default: false },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const { layout, config: clawletsConfig } = loadClawletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    const hostCfg = clawletsConfig.hosts[hostName];
    if (!hostCfg) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const opentofuDir = getHostOpenTofuDir(layout, hostName);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg });
    const driver = getProvisionerDriver(spec.provider);
    const runtime = {
      repoRoot,
      opentofuDir,
      nixBin: String(deployCreds.values.NIX_BIN || "nix").trim() || "nix",
      dryRun: args.dryRun,
      redact: [deployCreds.values.HCLOUD_TOKEN, deployCreds.values.GITHUB_TOKEN].filter(Boolean) as string[],
      credentials: {
        hcloudToken: deployCreds.values.HCLOUD_TOKEN,
        githubToken: deployCreds.values.GITHUB_TOKEN,
      },
    };

    const force = Boolean((args as any).force);
    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    if (!force) {
      if (!interactive) throw new Error("refusing to destroy without --force (no TTY)");
      p.intro("clawlets infra destroy");
      const ok = await p.confirm({
        message: `Destroy ${spec.provider} resources for host ${hostName}?`,
        initialValue: false,
      });
      if (p.isCancel(ok) || !ok) {
        p.cancel("canceled");
        return;
      }
    }

    await driver.destroy({ spec, runtime });
    const providerStateDir = path.join(opentofuDir, "providers", spec.provider);

    console.log(`ok: provisioning destroyed for ${hostName}`);
    console.log(`hint: state in ${providerStateDir}`);
  },
});

export const infra = defineCommand({
  meta: {
    name: "infra",
    description: "Infrastructure operations (provider drivers).",
  },
  subCommands: {
    apply: infraApply,
    destroy: infraDestroy,
  },
});
