import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AwsProvisionSpec, ProvisionerRuntime } from "../../types.js";
import { capture, run } from "../../../runtime/run.js";
import { withFlakesEnv } from "../../../nix/nix-flakes.js";

const AWS_ASSET_SEGMENTS = ["assets", "opentofu", "providers", "aws"] as const;

function trimOrEmpty(value: unknown): string {
  return String(value || "").trim();
}

export function resolveAwsOpenTofuWorkDir(runtime: ProvisionerRuntime): string {
  return path.join(runtime.opentofuDir, "providers", "aws");
}

function resolveBundledAwsAssetDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "..", "..", ...AWS_ASSET_SEGMENTS),
    path.resolve(here, "..", "..", "..", ...AWS_ASSET_SEGMENTS),
    path.resolve(here, "..", "..", ...AWS_ASSET_SEGMENTS),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`missing bundled aws OpenTofu assets: ${candidates.join(", ")}`);
}

function ensureAwsOpenTofuWorkDir(runtime: ProvisionerRuntime): string {
  const srcDir = resolveBundledAwsAssetDir();
  const workDir = resolveAwsOpenTofuWorkDir(runtime);

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
  spec: AwsProvisionSpec;
  runtime: ProvisionerRuntime;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = withFlakesEnv({
    ...process.env,
    AWS_REGION: params.spec.aws.region,
    AWS_DEFAULT_REGION: params.spec.aws.region,
  });

  const accessKeyId = trimOrEmpty(params.runtime.credentials.awsAccessKeyId);
  const secretAccessKey = trimOrEmpty(params.runtime.credentials.awsSecretAccessKey);
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error("AWS credentials must include both awsAccessKeyId and awsSecretAccessKey");
  }
  if (accessKeyId && secretAccessKey) {
    env.AWS_ACCESS_KEY_ID = accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  }

  const sessionToken = trimOrEmpty(params.runtime.credentials.awsSessionToken);
  if (sessionToken) env.AWS_SESSION_TOKEN = sessionToken;

  return env;
}

function tofuArgs(tfArgs: string[]): string[] {
  return ["run", "--impure", "nixpkgs#opentofu", "--", ...tfArgs];
}

function buildSharedTfArgs(spec: AwsProvisionSpec): string[] {
  const args = [
    "-var",
    `host_name=${spec.hostName}`,
    "-var",
    `admin_cidr=${spec.ssh.adminCidr}`,
    "-var",
    `admin_cidr_is_world_open=${spec.ssh.adminCidrAllowWorldOpen ? "true" : "false"}`,
    "-var",
    `ssh_exposure_mode=${spec.sshExposureMode}`,
    "-var",
    `tailnet_mode=${spec.tailnetMode}`,
    "-var",
    `tailscale_udp_ingress_enabled=${spec.aws.allowTailscaleUdpIngress ? "true" : "false"}`,
    "-var",
    `region=${spec.aws.region}`,
    "-var",
    `instance_type=${spec.aws.instanceType}`,
    "-var",
    `ami_id=${spec.aws.amiId}`,
    "-var",
    `use_default_vpc=${spec.aws.useDefaultVpc ? "true" : "false"}`,
    "-var",
    `ssh_public_key=${spec.ssh.publicKey}`,
  ];

  if (spec.aws.vpcId) args.push("-var", `vpc_id=${spec.aws.vpcId}`);
  if (spec.aws.subnetId) args.push("-var", `subnet_id=${spec.aws.subnetId}`);
  return args;
}

export async function applyAwsOpenTofu(params: {
  spec: AwsProvisionSpec;
  runtime: ProvisionerRuntime;
}): Promise<void> {
  const workDir = ensureAwsOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, runtime: params.runtime });
  const redact = (params.runtime.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(params.runtime.nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: workDir,
    env,
    dryRun: params.runtime.dryRun,
    redact,
  });

  await run(
    params.runtime.nixBin,
    tofuArgs(["apply", "-auto-approve", "-input=false", ...buildSharedTfArgs(params.spec)]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
      redact,
    },
  );
}

export async function destroyAwsOpenTofu(params: {
  spec: AwsProvisionSpec;
  runtime: ProvisionerRuntime;
}): Promise<void> {
  const workDir = ensureAwsOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, runtime: params.runtime });
  const redact = (params.runtime.redact || []).filter((value) => Boolean(value && value.trim()));

  await run(params.runtime.nixBin, tofuArgs(["init", "-input=false"]), {
    cwd: workDir,
    env,
    dryRun: params.runtime.dryRun,
    redact,
  });

  await run(
    params.runtime.nixBin,
    tofuArgs(["destroy", "-auto-approve", "-input=false", ...buildSharedTfArgs(params.spec)]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
      redact,
    },
  );
}

export async function readAwsOpenTofuOutput(params: {
  name: string;
  spec: AwsProvisionSpec;
  runtime: ProvisionerRuntime;
}): Promise<string> {
  if (params.runtime.dryRun) return `<opentofu-output:${params.name}>`;

  const workDir = ensureAwsOpenTofuWorkDir(params.runtime);
  const env = buildTofuEnv({ spec: params.spec, runtime: params.runtime });
  const out = await capture(
    params.runtime.nixBin,
    tofuArgs(["output", "-raw", params.name]),
    {
      cwd: workDir,
      env,
      dryRun: params.runtime.dryRun,
    },
  );

  return trimOrEmpty(out);
}
