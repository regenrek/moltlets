import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { loadDeployCreds } from "@clawlets/core/lib/infra/deploy-creds";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { coerceTrimmedString, formatUnknown } from "@clawlets/shared/lib/strings";
import { resolveAwsCliCredentials } from "./provider-runtime.js";

function trimOrEmpty(value: unknown): string {
  return coerceTrimmedString(value);
}

function parseDurationToMs(raw: string): number | null {
  const s = trimOrEmpty(raw);
  if (!s) return null;
  const m = s.match(/^(\d+)\s*([smhd])$/i);
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
  return ms;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function requireAwsProvider(params: {
  hostName: string;
  hostCfg: any;
}): void {
  const provider = trimOrEmpty(params.hostCfg?.provisioning?.provider || "hetzner");
  if (provider !== "aws") {
    throw new Error(`host ${params.hostName} uses provisioning.provider=${provider}; use provider=aws for AWS image pipeline`);
  }
}

function resolveAwsRegion(params: {
  hostCfg: any;
  regionArg: unknown;
}): string {
  const region = trimOrEmpty(params.regionArg || params.hostCfg?.aws?.region || "");
  if (!region) {
    throw new Error("missing AWS region (set hosts.<host>.aws.region or pass --region)");
  }
  return region;
}

function resolveAwsEnv(params: {
  deployCreds: ReturnType<typeof loadDeployCreds>;
  region: string;
}): {
  env: NodeJS.ProcessEnv;
  redact: string[];
} {
  const aws = resolveAwsCliCredentials(params.deployCreds);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_REGION: params.region,
    AWS_DEFAULT_REGION: params.region,
  };

  if (aws.accessKeyId && aws.secretAccessKey) {
    env.AWS_ACCESS_KEY_ID = aws.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = aws.secretAccessKey;
  }
  if (aws.sessionToken) {
    env.AWS_SESSION_TOKEN = aws.sessionToken;
  }

  const redact = [
    aws.secretAccessKey,
    aws.sessionToken,
  ].filter(Boolean) as string[];

  return { env, redact };
}

function resolveImagePath(params: {
  cwd: string;
  imagePathArg: unknown;
}): string {
  const raw = trimOrEmpty(params.imagePathArg);
  if (!raw) throw new Error("missing --image-path");
  const abs = path.isAbsolute(raw) ? raw : path.resolve(params.cwd, raw);
  if (!fs.existsSync(abs)) throw new Error(`image path missing: ${abs}`);
  return abs;
}

type AwsImportParams = {
  bucket: string;
  key: string;
  name: string;
  description: string;
  architecture: "x86_64" | "arm64";
  timeoutMs: number;
  pollMs: number;
  env: NodeJS.ProcessEnv;
  redact: string[];
  dryRun: boolean;
};

async function runAwsImageImport(params: AwsImportParams): Promise<string> {
  const diskContainers = JSON.stringify([
    {
      Description: params.description,
      Format: "raw",
      UserBucket: {
        S3Bucket: params.bucket,
        S3Key: params.key,
      },
    },
  ]);

  const importArgs = [
    "ec2",
    "import-image",
    "--description",
    params.description,
    "--architecture",
    params.architecture,
    "--platform",
    "Linux",
    "--boot-mode",
    "uefi-preferred",
    "--disk-containers",
    diskContainers,
    "--tag-specifications",
    `ResourceType=image,Tags=[{Key=Name,Value=${params.name}},{Key=ManagedBy,Value=clawlets}]`,
    "--output",
    "json",
  ];

  if (params.dryRun) {
    await run("aws", importArgs, {
      env: params.env,
      dryRun: true,
      redact: params.redact,
    });
    return "<dry-run-ami-id>";
  }

  const importOut = await capture("aws", importArgs, {
    env: params.env,
    redact: params.redact,
  });

  let importTaskId = "";
  try {
    importTaskId = trimOrEmpty(JSON.parse(importOut)?.ImportTaskId);
  } catch (error) {
    throw new Error(`aws import-image returned invalid JSON (${formatUnknown(error)})`, { cause: error });
  }

  if (!importTaskId) {
    throw new Error("aws import-image did not return ImportTaskId");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    await sleep(params.pollMs);

    const statusOut = await capture(
      "aws",
      ["ec2", "describe-import-image-tasks", "--import-task-ids", importTaskId, "--output", "json"],
      {
        env: params.env,
        redact: params.redact,
      },
    );

    let task: any;
    try {
      task = JSON.parse(statusOut)?.ImportImageTasks?.[0];
    } catch (error) {
      throw new Error(`aws describe-import-image-tasks returned invalid JSON (${String((error as Error)?.message || error)})`, { cause: error });
    }

    if (!task) {
      throw new Error(`missing import task status for ${importTaskId}`);
    }

    const status = trimOrEmpty(task.Status).toLowerCase();
    const statusMessage = trimOrEmpty(task.StatusMessage || "");
    if (status === "completed") {
      const imageId = trimOrEmpty(task.ImageId);
      if (!imageId) throw new Error(`import completed without ImageId (${importTaskId})`);
      return imageId;
    }
    if (["deleted", "deleting", "cancelled", "cancelling"].includes(status)) {
      throw new Error(`aws image import failed (${status}): ${statusMessage || "unknown error"}`);
    }
  }

  throw new Error(`timed out waiting for AWS image import after ${params.timeoutMs}ms`);
}

const awsImageUpload = defineCommand({
  meta: {
    name: "upload",
    description: "Upload raw image to S3 for AWS AMI import.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    "image-path": { type: "string", description: "Path to local raw image file." },
    bucket: { type: "string", description: "S3 bucket for image uploads." },
    key: { type: "string", description: "S3 object key (default: images/<host>/<filename>).", },
    region: { type: "string", description: "AWS region override (default: host aws.region)." },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    requireAwsProvider({ hostName, hostCfg });

    const imagePath = resolveImagePath({ cwd, imagePathArg: (args as any)["image-path"] });
    const bucket = trimOrEmpty((args as any).bucket);
    if (!bucket) throw new Error("missing --bucket");

    const keyRaw = trimOrEmpty(args.key);
    const key = keyRaw || path.posix.join("images", hostName, path.basename(imagePath));
    const region = resolveAwsRegion({ hostCfg, regionArg: args.region });

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const aws = resolveAwsEnv({ deployCreds, region });
    await run(
      "aws",
      ["s3", "cp", imagePath, `s3://${bucket}/${key}`],
      {
        env: aws.env,
        dryRun: args.dryRun,
        redact: aws.redact,
      },
    );

    console.log(`ok: uploaded ${imagePath}`);
    console.log(`s3://${bucket}/${key}`);
  },
});

const awsImageImport = defineCommand({
  meta: {
    name: "import",
    description: "Import a raw S3 image into AMI and print the AMI ID.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    bucket: { type: "string", description: "S3 bucket containing the uploaded raw image." },
    key: { type: "string", description: "S3 object key for the uploaded raw image." },
    name: { type: "string", description: "AMI name (default: clawlets-<host>-<timestamp>)." },
    description: { type: "string", description: "AMI description (default: clawlets <host>)." },
    architecture: { type: "string", description: "AMI architecture (x86_64|arm64).", default: "x86_64" },
    region: { type: "string", description: "AWS region override (default: host aws.region)." },
    waitTimeout: { type: "string", description: "Import wait timeout (<n><s|m|h|d>, default 20m).", default: "20m" },
    waitPoll: { type: "string", description: "Import poll interval (<n><s|m|h|d>, default 15s).", default: "15s" },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    requireAwsProvider({ hostName, hostCfg });

    const bucket = trimOrEmpty((args as any).bucket);
    if (!bucket) throw new Error("missing --bucket");
    const key = trimOrEmpty((args as any).key);
    if (!key) throw new Error("missing --key");
    const region = resolveAwsRegion({ hostCfg, regionArg: args.region });

    const architectureRaw = trimOrEmpty(args.architecture || "x86_64");
    if (architectureRaw !== "x86_64" && architectureRaw !== "arm64") {
      throw new Error("invalid --architecture (expected x86_64|arm64)");
    }
    const architecture = architectureRaw as "x86_64" | "arm64";

    const waitTimeoutRaw = trimOrEmpty((args as any).waitTimeout || "20m") || "20m";
    const waitPollRaw = trimOrEmpty((args as any).waitPoll || "15s") || "15s";
    const timeoutMs = parseDurationToMs(waitTimeoutRaw);
    if (!timeoutMs) throw new Error(`invalid --wait-timeout: ${waitTimeoutRaw} (expected <n><s|m|h|d>)`);
    const pollMs = parseDurationToMs(waitPollRaw);
    if (!pollMs) throw new Error(`invalid --wait-poll: ${waitPollRaw} (expected <n><s|m|h|d>)`);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const aws = resolveAwsEnv({ deployCreds, region });
    const name = trimOrEmpty(args.name) || `clawlets-${hostName}-${Date.now()}`;
    const description = trimOrEmpty(args.description) || `clawlets ${hostName}`;
    const amiId = await runAwsImageImport({
      bucket,
      key,
      name,
      description,
      architecture,
      timeoutMs,
      pollMs,
      env: aws.env,
      redact: aws.redact,
      dryRun: args.dryRun,
    });

    console.log(`ok: imported AWS AMI ${amiId}`);
    console.log(`hint: clawlets host set --host ${hostName} --aws-ami-id ${amiId}`);
  },
});

const awsImagePublish = defineCommand({
  meta: {
    name: "publish",
    description: "Upload raw image to S3 then import as AMI (AWS Phase 2 path).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    "image-path": { type: "string", description: "Path to local raw image file." },
    bucket: { type: "string", description: "S3 bucket for image uploads/imports." },
    key: { type: "string", description: "S3 object key (default: images/<host>/<filename>).", },
    name: { type: "string", description: "AMI name (default: clawlets-<host>-<timestamp>)." },
    description: { type: "string", description: "AMI description (default: clawlets <host>)." },
    architecture: { type: "string", description: "AMI architecture (x86_64|arm64).", default: "x86_64" },
    region: { type: "string", description: "AWS region override (default: host aws.region)." },
    waitTimeout: { type: "string", description: "Import wait timeout (<n><s|m|h|d>, default 20m).", default: "20m" },
    waitPoll: { type: "string", description: "Import poll interval (<n><s|m|h|d>, default 15s).", default: "15s" },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;
    requireAwsProvider({ hostName, hostCfg });

    const imagePath = resolveImagePath({ cwd, imagePathArg: (args as any)["image-path"] });
    const bucket = trimOrEmpty((args as any).bucket);
    if (!bucket) throw new Error("missing --bucket");
    const region = resolveAwsRegion({ hostCfg, regionArg: args.region });
    const keyRaw = trimOrEmpty(args.key);
    const key = keyRaw || path.posix.join("images", hostName, path.basename(imagePath));

    const architectureRaw = trimOrEmpty(args.architecture || "x86_64");
    if (architectureRaw !== "x86_64" && architectureRaw !== "arm64") {
      throw new Error("invalid --architecture (expected x86_64|arm64)");
    }
    const architecture = architectureRaw as "x86_64" | "arm64";

    const waitTimeoutRaw = trimOrEmpty((args as any).waitTimeout || "20m") || "20m";
    const waitPollRaw = trimOrEmpty((args as any).waitPoll || "15s") || "15s";
    const timeoutMs = parseDurationToMs(waitTimeoutRaw);
    if (!timeoutMs) throw new Error(`invalid --wait-timeout: ${waitTimeoutRaw} (expected <n><s|m|h|d>)`);
    const pollMs = parseDurationToMs(waitPollRaw);
    if (!pollMs) throw new Error(`invalid --wait-poll: ${waitPollRaw} (expected <n><s|m|h|d>)`);

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    if (deployCreds.envFile?.status === "invalid") throw new Error(`deploy env file rejected: ${deployCreds.envFile.path} (${deployCreds.envFile.error || "invalid"})`);
    if (deployCreds.envFile?.status === "missing") throw new Error(`missing deploy env file: ${deployCreds.envFile.path}`);

    const aws = resolveAwsEnv({ deployCreds, region });
    await run(
      "aws",
      ["s3", "cp", imagePath, `s3://${bucket}/${key}`],
      {
        env: aws.env,
        dryRun: args.dryRun,
        redact: aws.redact,
      },
    );

    const name = trimOrEmpty(args.name) || `clawlets-${hostName}-${Date.now()}`;
    const description = trimOrEmpty(args.description) || `clawlets ${hostName}`;
    const amiId = await runAwsImageImport({
      bucket,
      key,
      name,
      description,
      architecture,
      timeoutMs,
      pollMs,
      env: aws.env,
      redact: aws.redact,
      dryRun: args.dryRun,
    });

    console.log(`ok: uploaded image + imported AMI ${amiId}`);
    console.log(`hint: clawlets host set --host ${hostName} --aws-ami-id ${amiId}`);
  },
});

export const imageAws = defineCommand({
  meta: {
    name: "aws",
    description: "AWS image pipeline helpers (upload/import/publish AMIs).",
  },
  subCommands: {
    upload: awsImageUpload,
    import: awsImageImport,
    publish: awsImagePublish,
  },
});
