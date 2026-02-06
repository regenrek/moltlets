import { defineDeployCredsKeySpecs } from "./types.js";

export const HETZNER_DEPLOY_CREDS_KEY_SPECS = defineDeployCredsKeySpecs([
  { key: "HCLOUD_TOKEN", secret: true, defaultValue: "" },
] as const);
