import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libRoot = path.join(root, "packages", "core", "src", "lib");

const REQUIRED_DOMAINS = ["openclaw", "secrets", "nix", "runtime", "config", "infra"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

const DOMAIN_RULES = {
  openclaw: {
    allow: new Set(["openclaw", "secrets", "nix", "runtime", "config"]),
    allowRoot: true,
    requireBarrelForCrossDomain: true,
  },
  secrets: {
    allow: new Set(["secrets", "openclaw", "nix", "runtime", "config"]),
    allowRoot: true,
    requireBarrelForCrossDomain: true,
  },
  nix: {
    allow: new Set(["nix", "secrets", "runtime", "config", "infra"]),
    allowRoot: true,
    requireBarrelForCrossDomain: true,
  },
  runtime: {
    allow: new Set(["runtime", "config"]),
    allowRoot: true,
    requireBarrelForCrossDomain: true,
  },
  config: {
    allow: new Set(["config", "openclaw", "secrets", "nix", "runtime"]),
    allowRoot: true,
    requireBarrelForCrossDomain: false,
  },
  infra: {
    allow: new Set(["infra", "config", "nix", "runtime"]),
    allowRoot: true,
    requireBarrelForCrossDomain: false,
  },
};

const CROSS_DOMAIN_LEAF_ALLOW = {
  openclaw: {
    secrets: new Set(["env-vars.ts"]),
  },
};

function collectTypeScriptFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function getDomain(filePath) {
  const rel = path.relative(libRoot, filePath);
  if (rel.startsWith("..")) return null;

  const [head] = rel.split(path.sep);
  if (REQUIRED_DOMAINS.includes(head)) return head;
  return "root";
}

function collectRelativeSpecifiers(sourceText) {
  const specifiers = new Set();
  const patterns = [/from\s+["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']\s*\)/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(sourceText)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
}

function resolveImport(sourceFile, specifier) {
  const abs = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [abs];

  if (abs.endsWith(".js") || abs.endsWith(".mjs") || abs.endsWith(".cjs")) {
    const withoutExt = abs.replace(/\.[^.]+$/, "");
    candidates.push(`${withoutExt}.ts`);
    candidates.push(`${withoutExt}.mts`);
    candidates.push(path.join(withoutExt, "index.ts"));
  } else if (!path.extname(abs)) {
    candidates.push(`${abs}.ts`);
    candidates.push(`${abs}.mts`);
    candidates.push(path.join(abs, "index.ts"));
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    if (!fs.statSync(candidate).isFile()) continue;
    return path.normalize(candidate);
  }

  return null;
}

const errors = [];

for (const domain of REQUIRED_DOMAINS) {
  const domainDir = path.join(libRoot, domain);
  if (!fs.existsSync(domainDir) || !fs.statSync(domainDir).isDirectory()) {
    errors.push(`Missing domain directory: packages/core/src/lib/${domain}`);
    continue;
  }
  const indexFile = path.join(domainDir, "index.ts");
  if (!fs.existsSync(indexFile) || !fs.statSync(indexFile).isFile()) {
    errors.push(`Missing domain barrel: packages/core/src/lib/${domain}/index.ts`);
  }
}

const files = [];
collectTypeScriptFiles(libRoot, files);

for (const file of files) {
  const sourceDomain = getDomain(file);
  if (sourceDomain === null || sourceDomain === "root") continue;

  const rule = DOMAIN_RULES[sourceDomain];
  if (!rule) continue;

  const sourceText = fs.readFileSync(file, "utf8");
  const specifiers = collectRelativeSpecifiers(sourceText);

  for (const specifier of specifiers) {
    const targetFile = resolveImport(file, specifier);
    if (!targetFile) continue;

    const targetDomain = getDomain(targetFile);
    if (targetDomain === null) continue;

    if (targetDomain === "root") {
      if (!rule.allowRoot) {
        errors.push(
          `${toPosix(path.relative(root, file))} imports root module ${specifier}, but ${sourceDomain} disallows root imports`,
        );
      }
      continue;
    }

    if (!rule.allow.has(targetDomain)) {
      errors.push(
        `${toPosix(path.relative(root, file))} imports ${toPosix(path.relative(libRoot, targetFile))}, disallowed: ${sourceDomain} -> ${targetDomain}`,
      );
      continue;
    }

    if (!rule.requireBarrelForCrossDomain) continue;
    if (targetDomain === sourceDomain) continue;

    const targetRelInDomain = toPosix(path.relative(path.join(libRoot, targetDomain), targetFile));
    if (targetRelInDomain !== "index.ts") {
      const allow = CROSS_DOMAIN_LEAF_ALLOW[sourceDomain]?.[targetDomain];
      if (allow?.has(targetRelInDomain)) continue;
      errors.push(
        `${toPosix(path.relative(root, file))} imports ${toPosix(path.relative(libRoot, targetFile))}; cross-domain imports must go through ${targetDomain}/index.ts`,
      );
    }
  }
}

if (errors.length) {
  console.error(`core lib domain boundary violations:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("core lib domain boundaries ok");
