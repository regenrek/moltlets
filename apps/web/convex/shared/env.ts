const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

function parseBooleanEnv(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return TRUE_ENV_VALUES.has(normalized);
}

export function isAuthDisabled(): boolean {
  return parseBooleanEnv(
    process.env.CLAWLETS_AUTH_DISABLED || process.env.VITE_CLAWLETS_AUTH_DISABLED,
  );
}

export function hasAuthEnv(): boolean {
  const siteUrl = String(process.env.SITE_URL || "").trim();
  const secret = String(process.env.BETTER_AUTH_SECRET || "").trim();
  return Boolean(siteUrl && secret);
}
