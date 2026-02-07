export type SecretsScope = "bootstrap" | "updates" | "openclaw" | "all"

export const SECRETS_VERIFY_RUN_KINDS = {
  all: "secrets_verify",
  bootstrap: "secrets_verify_bootstrap",
  openclaw: "secrets_verify_openclaw",
} as const

export type SecretsVerifyRunKind = (typeof SECRETS_VERIFY_RUN_KINDS)[keyof typeof SECRETS_VERIFY_RUN_KINDS]

export const SECRETS_VERIFY_BOOTSTRAP_RUN_KIND = SECRETS_VERIFY_RUN_KINDS.bootstrap
export const SECRETS_VERIFY_OPENCLAW_RUN_KIND = SECRETS_VERIFY_RUN_KINDS.openclaw

export function getSecretsVerifyRunKind(scope: SecretsScope): SecretsVerifyRunKind {
  if (scope === "bootstrap") return SECRETS_VERIFY_RUN_KINDS.bootstrap
  if (scope === "openclaw") return SECRETS_VERIFY_RUN_KINDS.openclaw
  return SECRETS_VERIFY_RUN_KINDS.all
}

