import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHcloudSshKeyId } from "./hcloud.js";
import type { HetznerProvisionSpec, ProvisionerRuntime } from "../../types.js";
import { capture, run } from "../../../runtime/run.js";
import { withFlakesEnv } from "../../../nix/nix-flakes.js";

const HETZNER_ASSET_SEGMENTS = ["assets", "opentofu", "providers", "hetzner"] as const;

export function resolveHetznerOpenTofuWorkDir(runtime: ProvisionerRuntime): string {
  return path.join(runtime.opentofuDir, "providers", "hetzner");
}

function resolveBundledHetznerAssetDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", "..", ...HETZNER_ASSET_SEGMENTS),
    path.resolve(here, "..", "..", "..", ...HETZNER_ASSET_SEGMENTS),
    path.resolve(here, "..", "..", ...HETZNER_ASSET_SEGMENTS),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`missing bundled hetzner OpenTofu assets: ${candidates.join(", ")}`);
}

function ensureHetznerOpenTofuWorkDir(runtime: ProvisionerRuntime): string {
  const srcDir = resolveBundledHetznerAssetDir();
  const workDir = resolveHetznerOpenTofuWorkDir(runtime);

  fs.mkdirSync(workDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(workDir, entry.name);
    fs.cpSync(src, dest, { recursive: true });
  }

  return workDir;
}

function buildTofuEnv(params: {
  spec: HetznerProvisionSpec;
  hcloudToken: string;
}): NodeJS.ProcessEnv {
  return withFlakesEnv({
    ...process.env,
    HCLOUD_TOKEN: params.hcloudToken,
    ADMIN_CIDR: params.spec.ssh.adminCidr,
    SSH_PUBKEY_FILE: params.spec.ssh.publicKeyPath,
    SERVER_TYPE: params.spec.hetzner.serverType,
  });
}

function tofuArgs(tfArgs: string[]): string[] {
  return ["run", "--impure", "nixpkgs#opentofu", "--", ...tfArgs];
}

function buildSharedTfArgs(params: {
  spec: HetznerProvisionSpec;
  sshKeyId: string;
}): string[] {
  const args = [
    "-var",
    `host_name=${params.spec.hostName}`,
    "-var",
    `admin_cidr=${params.spec.ssh.adminCidr}`,
    "-var",
    `admin_cidr_is_world_open=${params.spec.ssh.adminCidrAllowWorldOpen ? "true" : "false"}`,
    "-var",
    `ssh_key_id=${params.sshKeyId}`,
    "-var",
    `ssh_exposure_mode=${params.spec.sshExposureMode}`,
    "-var",
    `tailnet_mode=${params.spec.tailnetMode}`,
    "-var",
    `tailscale_udp_ingress_enabled=${params.spec.hetzner.allowTailscaleUdpIngress ? "true" : "false"}`,
  ];

  const serverType = String(params.spec.hetzner.serverType || "").trim();
  const image = String(params.spec.hetzner.image || "").trim();
  const location = String(params.spec.hetzner.location || "").trim();

  if (serverType) args.push("-var", `server_type=${serverType}`);
  if (image) args.push("-var", `image=${image}`);
  if (location) args.push("-var", `location=${location}`);

  return args;
}

async function ensureHcloudSshKeyIdForSpec(params: {
  spec: HetznerProvisionSpec;
  hcloudToken: string;
  runtime: ProvisionerRuntime;
}): Promise<string> {
  if (params.runtime.dryRun) return "<hcloud-ssh-key-id>";

  const sshPublicKey = fs.readFileSync(params.spec.ssh.publicKeyPath, "utf8").trim();
  return ensureHcloudSshKeyId({
    token: params.hcloudToken,
    name: "clawlets-admin",
    publicKey: sshPublicKey,
  });
}

export async function applyHetznerOpenTofu(params: {
  spec: HetznerProvisionSpec;
  runtime: ProvisionerRuntime;
  hcloudToken: string;
}): Promise<void> {
  const workDir = ensureHetznerOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, hcloudToken: params.hcloudToken });
  const redact = (params.runtime.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(params.runtime.nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: workDir,
    env,
    dryRun: params.runtime.dryRun,
    redact,
  });

  const sshKeyId = await ensureHcloudSshKeyIdForSpec({
    spec: params.spec,
    hcloudToken: params.hcloudToken,
    runtime: params.runtime,
  });

  await run(
    params.runtime.nixBin,
    tofuArgs(["apply", "-auto-approve", "-input=false", ...buildSharedTfArgs({ spec: params.spec, sshKeyId })]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
      redact,
    },
  );
}

export async function destroyHetznerOpenTofu(params: {
  spec: HetznerProvisionSpec;
  runtime: ProvisionerRuntime;
  hcloudToken: string;
}): Promise<void> {
  const workDir = ensureHetznerOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, hcloudToken: params.hcloudToken });
  const redact = (params.runtime.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(params.runtime.nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: workDir,
    env,
    dryRun: params.runtime.dryRun,
    redact,
  });

  const sshKeyId = await ensureHcloudSshKeyIdForSpec({
    spec: params.spec,
    hcloudToken: params.hcloudToken,
    runtime: params.runtime,
  });

  await run(
    params.runtime.nixBin,
    tofuArgs(["destroy", "-auto-approve", "-input=false", ...buildSharedTfArgs({ spec: params.spec, sshKeyId })]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
      redact,
    },
  );
}

export async function readHetznerOpenTofuOutput(params: {
  name: string;
  spec: HetznerProvisionSpec;
  runtime: ProvisionerRuntime;
  hcloudToken: string;
}): Promise<string> {
  if (params.runtime.dryRun) return `<opentofu-output:${params.name}>`;

  const workDir = ensureHetznerOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, hcloudToken: params.hcloudToken });
  const out = await capture(
    params.runtime.nixBin,
    tofuArgs(["output", "-raw", params.name]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
    },
  );

  return String(out || "").trim();
}
