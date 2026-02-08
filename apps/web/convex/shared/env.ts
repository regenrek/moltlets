export function hasAuthEnv(): boolean {
  const siteUrl = String(process.env.SITE_URL || "").trim();
  const secret = String(process.env.BETTER_AUTH_SECRET || "").trim();
  return Boolean(siteUrl && secret);
}
