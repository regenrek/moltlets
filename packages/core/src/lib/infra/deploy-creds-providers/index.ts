import type { DeployCredsKeySpec } from "./types.js";
import { AWS_DEPLOY_CREDS_KEY_SPECS } from "./aws.js";
import { GITHUB_DEPLOY_CREDS_KEY_SPECS } from "./github.js";
import { HETZNER_DEPLOY_CREDS_KEY_SPECS } from "./hetzner.js";

export { defineDeployCredsKeySpecs, type DeployCredsKeySpec } from "./types.js";
export { AWS_DEPLOY_CREDS_KEY_SPECS } from "./aws.js";
export { GITHUB_DEPLOY_CREDS_KEY_SPECS } from "./github.js";
export { HETZNER_DEPLOY_CREDS_KEY_SPECS } from "./hetzner.js";

export const PROVIDER_DEPLOY_CREDS_KEY_SPECS: readonly DeployCredsKeySpec[] = [
  ...HETZNER_DEPLOY_CREDS_KEY_SPECS,
  ...GITHUB_DEPLOY_CREDS_KEY_SPECS,
  ...AWS_DEPLOY_CREDS_KEY_SPECS,
] as const;
