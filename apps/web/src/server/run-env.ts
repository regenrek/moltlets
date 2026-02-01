type AllowedEnv = ReadonlyArray<string>

export const CLAWLETS_CLI_ENV_ALLOWLIST: AllowedEnv = ["SSH_AUTH_SOCK", "SOPS_AGE_KEY_FILE"]

export function getClawletsCliEnv(): { env: NodeJS.ProcessEnv; envAllowlist: string[] } {
  const env: NodeJS.ProcessEnv = {}
  if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK
  if (process.env.SOPS_AGE_KEY_FILE) env.SOPS_AGE_KEY_FILE = process.env.SOPS_AGE_KEY_FILE
  return { env, envAllowlist: [...CLAWLETS_CLI_ENV_ALLOWLIST] }
}

