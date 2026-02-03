export type FleetPolicyViolation = {
  filePath: string;
  message: string;
  detail?: string;
};

export type FleetConfig = {
  gateways: string[];
  gatewayProfiles: Record<
    string,
    {
      skills?: {
        allowBundled?: unknown;
        entries?: Record<string, any>;
      };
      github?: {
        appId?: unknown;
        installationId?: unknown;
        privateKeySecret?: unknown;
      };
    }
  >;
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateFleetPolicy(params: {
  filePath: string;
  fleet: FleetConfig;
  knownBundledSkills: string[];
}): { ok: boolean; violations: FleetPolicyViolation[] } {
  const { filePath, fleet, knownBundledSkills } = params;
  const violations: FleetPolicyViolation[] = [];

  const gateways = Array.isArray(fleet.gateways) ? fleet.gateways : [];
  const gatewayProfiles = fleet.gatewayProfiles && typeof fleet.gatewayProfiles === "object" ? fleet.gatewayProfiles : {};

  if (gateways.length === 0) {
    violations.push({ filePath, message: "host bots list is empty or missing" });
    return { ok: false, violations };
  }

  for (const gatewayId of gateways) {
    const profile = gatewayProfiles[gatewayId];
    if (!profile) {
      violations.push({ filePath, message: `missing gatewayProfiles.${gatewayId}` });
      continue;
    }

    const allowBundled = profile.skills?.allowBundled;
    if (allowBundled == null) {
      violations.push({
        filePath,
        message: `gatewayProfiles.${gatewayId}.skills.allowBundled must be set (explicit allowlist required)`,
      });
      continue;
    }
    if (allowBundled === null) {
      violations.push({
        filePath,
        message: `gatewayProfiles.${gatewayId}.skills.allowBundled must not be null (null typically means allow-all)`,
      });
      continue;
    }
    if (!isStringArray(allowBundled)) {
      violations.push({ filePath, message: `gatewayProfiles.${gatewayId}.skills.allowBundled must be a list of strings` });
      continue;
    }

    const allow = allowBundled.map((s) => s.trim()).filter(Boolean);
    for (const s of allow) {
      if (!knownBundledSkills.includes(s)) {
        violations.push({
          filePath,
          message: `unknown bundled skill in gatewayProfiles.${gatewayId}.skills.allowBundled: ${s}`,
          detail: `known: ${knownBundledSkills.join(", ")}`,
        });
      }
    }

    if (allow.includes("github")) {
      const gh = profile.github || {};
      const ok = typeof gh.appId === "number" && typeof gh.installationId === "number" && typeof gh.privateKeySecret === "string" && gh.privateKeySecret.trim();
      if (!ok) {
        violations.push({
          filePath,
          message: `bundled skill "github" enabled for ${gatewayId} but missing gatewayProfiles.${gatewayId}.github.{ appId, installationId, privateKeySecret }`,
        });
      }
    }

    if (allow.includes("brave-search")) {
      const entries = profile.skills?.entries || {};
      const brave = entries["brave-search"] || {};
      const apiKeySecret = brave.apiKeySecret;
      const ok = typeof apiKeySecret === "string" && apiKeySecret.trim().length > 0;
      if (!ok) {
        violations.push({
          filePath,
          message: `bundled skill "brave-search" enabled for ${gatewayId} but missing skills.entries."brave-search".apiKeySecret`,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
