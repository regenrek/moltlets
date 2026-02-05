import fs from "node:fs";
import path from "node:path";

import { KNOWN_TOKEN_PATTERNS } from "@clawlets/shared/lib/token-patterns";

const OPENCLAW_SECRET_PATTERNS: { label: string; regex: RegExp }[] = [
  ...KNOWN_TOKEN_PATTERNS,
  { label: "literal token assignment", regex: /"token"\s*:\s*"(?!\$\{)(?!CHANGE_ME)(?!REDACTED)[^"]{16,}"/ },
];

const GATEWAY_CONFIG_FILENAMES = ["openclaw.json5"] as const;

const INCLUDE_PATTERN = /["']?\$include["']?\s*:\s*(['"])([^'"]+)\1/g;
const MAX_SCAN_BYTES = 128 * 1024;

function listOpenclawConfigFiles(root: string): string[] {
  const gatewaysDir = path.join(root, "fleet", "workspaces", "gateways");
  if (!fs.existsSync(gatewaysDir)) return [];
  const entries = fs.readdirSync(gatewaysDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const fileName of GATEWAY_CONFIG_FILENAMES) {
      const cfgPath = path.join(gatewaysDir, entry.name, fileName);
      if (fs.existsSync(cfgPath)) files.push(cfgPath);
    }
  }
  return files;
}

function readFilePrefix(filePath: string): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(MAX_SCAN_BYTES);
    const bytes = fs.readSync(fd, buf, 0, MAX_SCAN_BYTES, 0);
    return buf.subarray(0, bytes).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function extractIncludePaths(raw: string): string[] {
  const matches: string[] = [];
  for (const match of raw.matchAll(INCLUDE_PATTERN)) {
    const value = String(match[2] || "").trim();
    if (value) matches.push(value);
  }
  return matches;
}

function resolveIncludePath(params: {
  rootAbs: string;
  rootRealPrefix: string;
  baseDir: string;
  includePath: string;
}): string | null {
  const raw = params.includePath.trim();
  if (!raw || raw.includes("${")) return null;
  const rootAbsPrefix = params.rootAbs.endsWith(path.sep) ? params.rootAbs : params.rootAbs + path.sep;
  if (path.isAbsolute(raw)) {
    const full = path.resolve(raw);
    if (!full.startsWith(rootAbsPrefix)) return null;
    if (!fs.existsSync(full)) return null;
    try {
      const real = fs.realpathSync(full);
      if (!real.startsWith(params.rootRealPrefix)) return null;
    } catch {
      return null;
    }
    return full;
  }
  const full = path.resolve(params.baseDir, raw);
  if (!full.startsWith(rootAbsPrefix)) return null;
  if (!fs.existsSync(full)) return null;
  try {
    const real = fs.realpathSync(full);
    if (!real.startsWith(params.rootRealPrefix)) return null;
  } catch {
    return null;
  }
  return full;
}

export function findOpenclawSecretViolations(root: string): {
  files: string[];
  violations: { file: string; label: string }[];
} {
  const rootAbs = path.resolve(root);
  const rootRealPrefix = (() => {
    try {
      const real = fs.realpathSync(rootAbs);
      return real.endsWith(path.sep) ? real : real + path.sep;
    } catch {
      return (rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep);
    }
  })();

  const initial = listOpenclawConfigFiles(rootAbs);
  const files: string[] = [];
  const violations: { file: string; label: string }[] = [];
  const visited = new Set<string>();

  const scanFile = (filePath: string) => {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return;
    try {
      const real = fs.realpathSync(fullPath);
      if (!real.startsWith(rootRealPrefix)) return;
      if (visited.has(real)) return;
      visited.add(real);
    } catch {
      return;
    }
    files.push(fullPath);

    const raw = readFilePrefix(fullPath);
    for (const pattern of OPENCLAW_SECRET_PATTERNS) {
      if (pattern.regex.test(raw)) {
        violations.push({ file: fullPath, label: pattern.label });
        return;
      }
    }

    const includes = extractIncludePaths(raw);
    if (includes.length === 0) return;
    const baseDir = path.dirname(fullPath);
    for (const includePath of includes) {
      const resolved = resolveIncludePath({ rootAbs, rootRealPrefix, baseDir, includePath });
      if (!resolved) continue;
      scanFile(resolved);
    }
  };

  for (const filePath of initial) scanFile(filePath);
  return { files, violations };
}

export function findFleetSecretViolations(root: string): {
  files: string[];
  violations: { file: string; label: string }[];
} {
  const configPath = path.join(root, "fleet", "clawlets.json");
  if (!fs.existsSync(configPath)) return { files: [], violations: [] };
  const raw = readFilePrefix(configPath);
  for (const pattern of OPENCLAW_SECRET_PATTERNS) {
    if (pattern.regex.test(raw)) {
      return { files: [configPath], violations: [{ file: configPath, label: pattern.label }] };
    }
  }
  return { files: [configPath], violations: [] };
}
