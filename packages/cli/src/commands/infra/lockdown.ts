import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawlets/core/lib/deploy-creds";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { loadClawletsConfig } from "@clawlets/core/lib/clawlets-config";
import { getHostOpenTofuDir } from "@clawlets/core/repo-layout";
import { requireDeployGate } from "../../lib/deploy-gate.js";
import { resolveHostNameOrExit } from "@clawlets/core/lib/host-resolve";
import { buildHostProvisionSpec, getProvisionerDriver } from "@clawlets/core/lib/infra";
import { buildProvisionerRuntime } from "./provider-runtime.js";

export const lockdown = defineCommand({
  meta: {
    name: "lockdown",
    description: "Remove public SSH exposure via provider-specific lockdown.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    skipTofu: { type: "boolean", description: "Skip provisioning apply.", default: false },
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
    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg });
    const sshExposureMode = spec.sshExposureMode;
    if (sshExposureMode !== "tailnet") {
      throw new Error(`sshExposure.mode=${sshExposureMode}; set sshExposure.mode=tailnet before lockdown (clawlets host set --host ${hostName} --ssh-exposure tailnet)`);
    }

    await requireDeployGate({
      runtimeDir: (args as any).runtimeDir,
      envFile: (args as any).envFile,
      host: hostName,
      scope: "updates",
      strict: true,
      skipGithubTokenCheck: true,
    });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const driver = getProvisionerDriver(spec.provider);
    const runtime = buildProvisionerRuntime({
      repoRoot,
      opentofuDir,
      dryRun: args.dryRun,
      deployCreds,
    });

    if (!args.skipTofu) {
      await driver.lockdown({ spec, runtime });
    }
  },
});
