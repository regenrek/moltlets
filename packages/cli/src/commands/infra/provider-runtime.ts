import process from "node:process";
import type { DeployCredsResult } from "@clawlets/core/lib/infra/deploy-creds";
import type { ProvisionerRuntime } from "@clawlets/core/lib/infra/infra";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

function trimOrEmpty(value: unknown): string {
  return coerceTrimmedString(value);
}

function resolveFromEnvOrFile(params: {
  deployCreds: DeployCredsResult;
  key: string;
}): string | undefined {
  const fromEnv = trimOrEmpty(process.env[params.key]);
  if (fromEnv) return fromEnv;
  const fromFile = trimOrEmpty(params.deployCreds.envFromFile?.[params.key]);
  return fromFile || undefined;
}

export type AwsCliCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

export function resolveAwsCliCredentials(deployCreds: DeployCredsResult): AwsCliCredentials {
  const accessKeyId = resolveFromEnvOrFile({ deployCreds, key: "AWS_ACCESS_KEY_ID" });
  const secretAccessKey = resolveFromEnvOrFile({ deployCreds, key: "AWS_SECRET_ACCESS_KEY" });
  const sessionToken = resolveFromEnvOrFile({ deployCreds, key: "AWS_SESSION_TOKEN" });

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error("AWS credentials must include both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
  };
}

export function buildProvisionerRuntime(params: {
  repoRoot: string;
  opentofuDir: string;
  dryRun: boolean;
  deployCreds: DeployCredsResult;
}): ProvisionerRuntime {
  const aws = resolveAwsCliCredentials(params.deployCreds);

  return {
    repoRoot: params.repoRoot,
    opentofuDir: params.opentofuDir,
    nixBin: trimOrEmpty(params.deployCreds.values.NIX_BIN) || "nix",
    dryRun: params.dryRun,
    redact: [
      params.deployCreds.values.HCLOUD_TOKEN,
      params.deployCreds.values.GITHUB_TOKEN,
      aws.secretAccessKey,
      aws.sessionToken,
    ].filter(Boolean) as string[],
    credentials: {
      hcloudToken: params.deployCreds.values.HCLOUD_TOKEN,
      githubToken: params.deployCreds.values.GITHUB_TOKEN,
      awsAccessKeyId: aws.accessKeyId,
      awsSecretAccessKey: aws.secretAccessKey,
      awsSessionToken: aws.sessionToken,
    },
  };
}
