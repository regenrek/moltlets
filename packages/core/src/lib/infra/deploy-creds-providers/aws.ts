import { defineDeployCredsKeySpecs } from "./types.js";

export const AWS_DEPLOY_CREDS_KEY_SPECS = defineDeployCredsKeySpecs([
  { key: "AWS_ACCESS_KEY_ID", secret: true, defaultValue: "" },
  { key: "AWS_SECRET_ACCESS_KEY", secret: true, defaultValue: "" },
  { key: "AWS_SESSION_TOKEN", secret: true, defaultValue: "" },
] as const);
