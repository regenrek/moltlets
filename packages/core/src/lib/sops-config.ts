import YAML from "yaml";

export type SopsCreationRule = {
  path_regex: string;
  key_groups?: Array<{
    age?: string[];
    [k: string]: unknown;
  }>;
  // Legacy/invalid for modern sops configs; kept for parse/upgrade only.
  age?: unknown;
  [k: string]: unknown;
};

export type SopsConfig = {
  creation_rules?: unknown;
  [k: string]: unknown;
};

function normalizeRecipients(recipients: string[]): string[] {
  return Array.from(new Set(recipients.map((r) => r.trim()).filter(Boolean)));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sopsPathRegexForBasename(basename: string): string {
  // sops matches against the (possibly) full path; stdin + --filename-override can be "./file" etc.
  // Match both "file" and any path ending in "/file" or "\\file".
  return `(^|.*[\\\\/])${escapeRegex(basename)}$`;
}

export function sopsPathRegexForPathSuffix(pathSuffix: string): string {
  const clean = pathSuffix.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  const sep = "[\\\\/]";
  return `(^|.*${sep})${parts.map(escapeRegex).join(sep)}$`;
}

export function sopsPathRegexForDirFiles(dirPathSuffix: string, extension: string): string {
  const clean = dirPathSuffix.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  const sep = "[\\\\/]";
  const ext = extension.replace(/^\./, "");
  return `(^|.*${sep})${parts.map(escapeRegex).join(sep)}${sep}[^\\\\/]+\\.${escapeRegex(ext)}$`;
}

function splitLegacyAge(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeRecipients(value.map(String));
  if (typeof value === "string") {
    return normalizeRecipients(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return [];
}

function extractAgeRecipients(rule: SopsCreationRule): string[] {
  const fromGroups = Array.isArray(rule.key_groups)
    ? rule.key_groups.flatMap((g) => (Array.isArray(g?.age) ? g.age : []))
    : [];

  const fromLegacy = splitLegacyAge(rule.age);
  return normalizeRecipients([...fromGroups, ...fromLegacy]);
}

function withAgeRecipients(rule: SopsCreationRule, recipients: string[]): SopsCreationRule {
  const nextGroups = Array.isArray(rule.key_groups) ? [...rule.key_groups] : [];

  let sawAge = false;
  for (let i = 0; i < nextGroups.length; i++) {
    const g = nextGroups[i];
    if (Array.isArray(g?.age)) {
      nextGroups[i] = { ...g, age: recipients };
      sawAge = true;
    }
  }
  if (!sawAge) nextGroups.push({ age: recipients });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { age: _legacyAge, ...rest } = rule;
  return { ...rest, key_groups: nextGroups, path_regex: rule.path_regex };
}

export function upsertSopsCreationRule(params: {
  existingYaml?: string;
  pathRegex: string;
  ageRecipients: string[];
}): string {
  const recipients = normalizeRecipients(params.ageRecipients);
  if (recipients.length === 0) throw new Error("no age recipients provided");

  const cfg: SopsConfig =
    params.existingYaml && params.existingYaml.trim().length > 0
      ? (YAML.parse(params.existingYaml) as SopsConfig)
      : {};

  const existingRulesRaw = cfg.creation_rules;
  const parsedRules: SopsCreationRule[] = Array.isArray(existingRulesRaw)
    ? (existingRulesRaw as SopsCreationRule[]).filter(
        (r): r is SopsCreationRule => Boolean(r && typeof r === "object"),
      )
    : [];

  const rules = parsedRules.map((r) => {
    const age = extractAgeRecipients(r);
    return age.length > 0 ? withAgeRecipients(r, age) : r;
  });

  const idx = rules.findIndex((r) => r?.path_regex === params.pathRegex);
  const nextRules = [...rules];

  if (idx >= 0) {
    const existing = nextRules[idx]!;
    const merged = normalizeRecipients([...extractAgeRecipients(existing), ...recipients]);
    nextRules[idx] = withAgeRecipients({ ...existing, path_regex: params.pathRegex }, merged);
  } else {
    nextRules.push(
      withAgeRecipients(
        {
          path_regex: params.pathRegex,
        },
        recipients,
      ),
    );
  }

  const next: SopsConfig = { ...cfg, creation_rules: nextRules };
  return YAML.stringify(next);
}

export function removeSopsCreationRule(params: { existingYaml?: string; pathRegex: string }): string {
  const cfg: SopsConfig =
    params.existingYaml && params.existingYaml.trim().length > 0
      ? (YAML.parse(params.existingYaml) as SopsConfig)
      : {};

  const existingRulesRaw = cfg.creation_rules;
  const parsedRules: SopsCreationRule[] = Array.isArray(existingRulesRaw)
    ? (existingRulesRaw as SopsCreationRule[]).filter(
        (r): r is SopsCreationRule => Boolean(r && typeof r === "object"),
      )
    : [];

  const nextRules = parsedRules.filter((r) => String(r?.path_regex || "") !== params.pathRegex);

  if (nextRules.length === 0) {
    const { creation_rules: _cr, ...rest } = cfg;
    return YAML.stringify(rest);
  }

  const next: SopsConfig = { ...cfg, creation_rules: nextRules };
  return YAML.stringify(next);
}

export function getSopsCreationRuleAgeRecipients(params: {
  existingYaml?: string;
  pathRegex: string;
}): string[] {
  if (!params.existingYaml || !params.existingYaml.trim()) return [];
  let cfg: SopsConfig | null = null;
  try {
    cfg = (YAML.parse(params.existingYaml) as SopsConfig) || {};
  } catch {
    return [];
  }
  const existingRulesRaw = cfg.creation_rules;
  const parsedRules: SopsCreationRule[] = Array.isArray(existingRulesRaw)
    ? (existingRulesRaw as SopsCreationRule[]).filter(
        (r): r is SopsCreationRule => Boolean(r && typeof r === "object"),
      )
    : [];
  const rule = parsedRules.find((r) => String(r?.path_regex || "") === params.pathRegex);
  if (!rule) return [];
  return extractAgeRecipients(rule);
}
