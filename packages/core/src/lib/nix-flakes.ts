function hasNeededExperimentalFeatures(existing: string): boolean {
  const normalized = existing.replace(/\s+/g, " ").toLowerCase();
  if (!normalized.includes("experimental-features")) return false;
  return normalized.includes("nix-command") && normalized.includes("flakes");
}

export function withFlakesEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...process.env, ...(env || {}) };
  const needed = "experimental-features = nix-command flakes";
  const existing = String(base.NIX_CONFIG || "").trim();
  if (!existing) return { ...base, NIX_CONFIG: needed };
  if (hasNeededExperimentalFeatures(existing)) return base;
  return { ...base, NIX_CONFIG: `${existing}\n${needed}` };
}
