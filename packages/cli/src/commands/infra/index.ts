import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { loadDeployCreds } from "@clawlets/core/lib/infra/deploy-creds";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { loadClawletsConfig } from "@clawlets/core/lib/config/clawlets-config";
import { getHostOpenTofuDir } from "@clawlets/core/repo-layout";
import { resolveHostNameOrExit } from "@clawlets/core/lib/host/host-resolve";
import { buildHostProvisionSpec, getProvisionerDriver } from "@clawlets/core/lib/infra/infra";
import { getHcloudServer, HcloudHttpError } from "@clawlets/core/lib/infra/providers/hetzner/hcloud";
import { resolveHostProvisioningConfig } from "../../lib/provisioning-ssh-pubkey-file.js";
import { buildProvisionerRuntime } from "./provider-runtime.js";

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function coerceTrimmed(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value).trim();
  if (typeof value === "bigint") return String(value).trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readTfstateOutputValue(state: unknown, name: string): string {
  const root = asObject(state);
  const outputs = asObject(root?.outputs);
  const entry = asObject(outputs?.[name]);
  return coerceTrimmed(entry?.value);
}

async function tryReadJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    const code = (err as any)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

const infraApply = defineCommand({
  meta: {
    name: "apply",
    description: "Apply provisioning for a host (driven by fleet/clawlets.json).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
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
    if (!clawletsConfig.hosts[hostName]) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const hostProvisioningConfig = resolveHostProvisioningConfig({
      repoRoot,
      layout,
      config: clawletsConfig,
      hostName,
    });
    const opentofuDir = getHostOpenTofuDir(layout, hostName);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg: hostProvisioningConfig.hostCfg });
    const driver = getProvisionerDriver(spec.provider);
    const runtime = buildProvisionerRuntime({
      repoRoot,
      opentofuDir,
      dryRun: args.dryRun,
      deployCreds,
    });

    const provisioned = await driver.provision({ spec, runtime });
    const providerStateDir = path.join(opentofuDir, "providers", spec.provider);

    console.log(`ok: provisioning applied for ${hostName}`);
    if (provisioned.instanceId) console.log(`instanceId: ${provisioned.instanceId}`);
    if (provisioned.ipv4) console.log(`ipv4: ${provisioned.ipv4}`);
    console.log(`hint: outputs in ${providerStateDir}`);
  },
});

const infraStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show provisioning status for a host (from OpenTofu state; verified via provider API when possible).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    json: { type: "boolean", description: "Output JSON.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const repoRoot = findRepoRoot(cwd);
    const hostName = resolveHostNameOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!hostName) return;
    const { layout, config: clawletsConfig } = loadClawletsConfig({ repoRoot, runtimeDir: (args as any).runtimeDir });
    if (!clawletsConfig.hosts[hostName]) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const hostProvisioningConfig = resolveHostProvisioningConfig({
      repoRoot,
      layout,
      config: clawletsConfig,
      hostName,
    });
    const opentofuDir = getHostOpenTofuDir(layout, hostName);

    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg: hostProvisioningConfig.hostCfg });
    // Ensure provider is supported even if we can't fully verify status.
    getProvisionerDriver(spec.provider);

    const providerStateDir = path.join(opentofuDir, "providers", spec.provider);
    const tfstatePath = path.join(providerStateDir, "terraform.tfstate");
    const state = await tryReadJsonFile(tfstatePath);
    const instanceId = readTfstateOutputValue(state, "instance_id");
    const ipv4FromState = readTfstateOutputValue(state, "ipv4");

    let exists = Boolean(instanceId);
    let ipv4 = ipv4FromState;
    let verified = false;
    let detail = state ? "" : `(missing: ${tfstatePath})`;
    if (state && !instanceId) {
      detail = detail || "instance_id missing in OpenTofu state (infra likely not applied or was destroyed)";
    }

    if (spec.provider === "hetzner" && instanceId) {
      try {
        const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
        const token = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
        if (!token) {
          detail = detail || "HCLOUD_TOKEN missing; status not verified via provider API";
        } else {
          try {
            const server = await getHcloudServer({ token, id: instanceId });
            verified = true;
            exists = true;
            const apiIpv4 = coerceTrimmed(server.public_net?.ipv4?.ip);
            if (apiIpv4) ipv4 = apiIpv4;
            detail = `hcloud server status=${coerceTrimmed(server.status) || "unknown"}`;
          } catch (err) {
            if (err instanceof HcloudHttpError && err.status === 404) {
              verified = true;
              exists = false;
              ipv4 = "";
              detail = `hcloud server not found (instance_id=${instanceId})`;
            } else {
              throw err;
            }
          }
        }
      } catch (err) {
        // Don't fail status entirely if deploy creds are missing; still report state-derived hint.
        const message = err instanceof Error ? err.message : String(err);
        detail = detail || `could not load deploy creds: ${message}`;
      }
    }

    const out = {
      ok: true,
      host: hostName,
      provider: spec.provider,
      exists,
      ...(instanceId ? { instanceId } : {}),
      ...(ipv4 ? { ipv4 } : {}),
      verified,
      ...(detail ? { detail } : {}),
    } as const;

    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    if (!exists) {
      console.log(`missing: ${spec.provider} resources for ${hostName}${detail ? ` ${detail}` : ""}`);
      return;
    }
    console.log(`ok: ${spec.provider} resources present for ${hostName}`);
    if (instanceId) console.log(`instanceId: ${instanceId}`);
    if (ipv4) console.log(`ipv4: ${ipv4}`);
    if (verified) console.log("verified: true");
  },
});

const infraDestroy = defineCommand({
  meta: {
    name: "destroy",
    description: "Destroy provisioned resources for a host (DANGEROUS).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: ~/.clawlets/workspaces/<repo>-<hash>; or $CLAWLETS_HOME/workspaces/<repo>-<hash>)." },
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
    if (!clawletsConfig.hosts[hostName]) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
    const hostProvisioningConfig = resolveHostProvisioningConfig({
      repoRoot,
      layout,
      config: clawletsConfig,
      hostName,
    });
    const opentofuDir = getHostOpenTofuDir(layout, hostName);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const spec = buildHostProvisionSpec({ repoRoot, hostName, hostCfg: hostProvisioningConfig.hostCfg });
    const driver = getProvisionerDriver(spec.provider);
    const runtime = buildProvisionerRuntime({
      repoRoot,
      opentofuDir,
      dryRun: args.dryRun,
      deployCreds,
    });

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
    status: infraStatus,
    destroy: infraDestroy,
  },
});
