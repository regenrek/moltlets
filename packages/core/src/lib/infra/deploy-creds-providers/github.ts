import { defineDeployCredsKeySpecs } from "./types.js";

export const GITHUB_DEPLOY_CREDS_KEY_SPECS = defineDeployCredsKeySpecs([
  { key: "GITHUB_TOKEN", secret: true, defaultValue: "" },
] as const);
