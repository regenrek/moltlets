import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ProviderInfo = {
  auth: "apiKey" | "oauth" | "mixed";
  credentials: Array<{ id: string; anyOfEnv: string[] }>;
  aliases?: string[];
};

type OpenclawSchemaArtifact = {
  schema?: unknown;
  uiHints?: unknown;
  version?: unknown;
  openclawRev?: unknown;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const argValue = (flag: string): string | null => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1] ?? null;
};

const readText = (p: string): string => fs.readFileSync(p, "utf8");
const readJson = <T = unknown>(p: string): T => JSON.parse(readText(p)) as T;

const extractBetweenMarkers = (params: {
  text: string;
  startMarker: string;
  endMarker: string;
  sourcePath: string;
}): string => {
  const startIdx = params.text.indexOf(params.startMarker);
  if (startIdx === -1) {
    throw new Error(
      `failed to parse ${params.sourcePath}: missing marker "${params.startMarker}"`,
    );
  }
  const endIdx = params.text.indexOf(params.endMarker, startIdx + params.startMarker.length);
  if (endIdx === -1) {
    throw new Error(
      `failed to parse ${params.sourcePath}: missing marker "${params.endMarker}" after "${params.startMarker}"`,
    );
  }
  return params.text.slice(startIdx + params.startMarker.length, endIdx);
};

const extractFunctionBody = (params: {
  text: string;
  functionName: string;
  sourcePath: string;
}): string => {
  const marker = `export function ${params.functionName}`;
  const fnStart = params.text.indexOf(marker);
  if (fnStart === -1) {
    throw new Error(`failed to parse ${params.sourcePath}: missing function "${params.functionName}"`);
  }
  const bodyStart = params.text.indexOf("{", fnStart);
  if (bodyStart === -1) {
    throw new Error(`failed to parse ${params.sourcePath}: missing body for "${params.functionName}"`);
  }
  let depth = 0;
  for (let i = bodyStart; i < params.text.length; i += 1) {
    const ch = params.text[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return params.text.slice(bodyStart + 1, i);
      }
    }
  }
  throw new Error(`failed to parse ${params.sourcePath}: unbalanced braces in "${params.functionName}"`);
};

const parseEnvMap = (params: { text: string; sourcePath: string }): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = extractBetweenMarkers({
    text: params.text,
    startMarker: "export function resolveEnvApiKey",
    endMarker: "export function resolveModelAuthMode",
    sourcePath: params.sourcePath,
  });
  const ifRegex = /if\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const body = match[2] ?? "";
    const envs = Array.from(body.matchAll(/pick\("([^"]+)"\)/g)).map((m) => String(m[1] || "").trim()).filter(Boolean);
    const providers = Array.from(condition.matchAll(/(?:provider|normalized)\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (providers.length === 0 || envs.length === 0) continue;
    for (const provider of providers) {
      out[provider] = Array.from(new Set([...(out[provider] ?? []), ...envs]));
    }
  }

  const envMapMatch = block.match(/const\s+envMap:[^{]*\{([\s\S]*?)\};/);
  if (envMapMatch) {
    const envMapBody = envMapMatch[1] ?? "";
    const entryRegex = /["']?([A-Za-z0-9-_]+)["']?\s*:\s*"([^"]+)"/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryRegex.exec(envMapBody))) {
      const provider = entry[1] ?? "";
      const envVar = entry[2] ?? "";
      if (!provider || !envVar) continue;
      out[provider] = Array.from(new Set([...(out[provider] ?? []), envVar]));
    }
  }
  if (Object.keys(out).length === 0) {
    throw new Error(
      `failed to parse ${params.sourcePath}: no provider env mappings extracted from resolveEnvApiKey block`,
    );
  }
  return out;
};

const readOAuthProviders = async (src: string): Promise<string[]> => {
  const oauthIndexPath = path.join(
    src,
    "node_modules",
    "@mariozechner",
    "pi-ai",
    "dist",
    "utils",
    "oauth",
    "index.js",
  );
  if (!fs.existsSync(oauthIndexPath)) {
    throw new Error(
      `missing OAuth module file: ${oauthIndexPath} (run install in openclaw source and ensure @mariozechner/pi-ai is present)`,
    );
  }

  let ids: string[] = [];
  try {
    const oauthModule = (await import(pathToFileURL(oauthIndexPath).href)) as {
      getOAuthProviders?: () => Array<{ id?: unknown }>;
      getOAuthProviderInfoList?: () => Array<{ id?: unknown }>;
    };
    const providers =
      (typeof oauthModule.getOAuthProviders === "function" && oauthModule.getOAuthProviders()) ||
      (typeof oauthModule.getOAuthProviderInfoList === "function" && oauthModule.getOAuthProviderInfoList()) ||
      [];
    ids = Array.isArray(providers)
      ? providers
          .map((provider) => {
            const id = provider?.id;
            return typeof id === "string" ? id.trim() : "";
          })
          .filter(Boolean)
      : [];
  } catch {
    // Fall back to static parsing for older module layouts.
  }

  if (ids.length === 0) {
    const oauthText = readText(oauthIndexPath);
    const body = extractFunctionBody({
      text: oauthText,
      functionName: "getOAuthProviders",
      sourcePath: oauthIndexPath,
    });
    ids = Array.from(body.matchAll(/\bid\s*:\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
  }

  if (ids.length === 0) {
    throw new Error(
      `failed to parse ${oauthIndexPath}: getOAuthProviders() contains no provider ids`,
    );
  }
  return Array.from(new Set(ids)).toSorted();
};

const parseProviderAliases = (params: {
  text: string;
  sourcePath: string;
}): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const block = extractBetweenMarkers({
    text: params.text,
    startMarker: "export function normalizeProviderId",
    endMarker: "export function isCliProvider",
    sourcePath: params.sourcePath,
  });
  const ifRegex = /if\s*\(([^)]*normalized[^)]*)\)\s*return\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = ifRegex.exec(block))) {
    const condition = match[1] ?? "";
    const canonical = match[2] ?? "";
    if (!canonical) continue;
    const aliases = Array.from(condition.matchAll(/normalized\s*===\s*"([^"]+)"/g))
      .map((m) => String(m[1] || "").trim())
      .filter(Boolean);
    if (aliases.length === 0) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), ...aliases]));
  }
  return out;
};

const parseEnvAliases = (text: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  const assignRegex = /process\.env\.([A-Z0-9_]+)\s*=\s*process\.env\.([A-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = assignRegex.exec(text))) {
    const canonical = match[1] ?? "";
    const alias = match[2] ?? "";
    if (!canonical || !alias || canonical === alias) continue;
    out[canonical] = Array.from(new Set([...(out[canonical] ?? []), alias]));
  }
  return out;
};

const buildProviderInfo = (params: {
  envMap: Record<string, string[]>;
  oauthProviders: string[];
  aliases: Record<string, string[]>;
}): Record<string, ProviderInfo> => {
  const providers = new Set<string>([
    ...Object.keys(params.envMap),
    ...params.oauthProviders,
    ...Object.keys(params.aliases),
  ]);
  const out: Record<string, ProviderInfo> = {};

  for (const provider of Array.from(providers).toSorted()) {
    const envVars = (params.envMap[provider] ?? []).slice().toSorted();
    const oauthVars = envVars.filter((v) => v.includes("OAUTH_TOKEN"));
    const apiVars = envVars.filter((v) => !v.includes("OAUTH_TOKEN"));

    let auth: ProviderInfo["auth"] = "apiKey";
    if (oauthVars.length > 0 && apiVars.length > 0) auth = "mixed";
    else if (oauthVars.length > 0 && apiVars.length === 0) auth = "oauth";
    else if (params.oauthProviders.includes(provider)) auth = envVars.length > 0 ? "mixed" : "oauth";

    const credentials: ProviderInfo["credentials"] = [];
    if (apiVars.length > 0) credentials.push({ id: "api_key", anyOfEnv: apiVars });
    if (oauthVars.length > 0) credentials.push({ id: "oauth_token", anyOfEnv: oauthVars });

    const info: ProviderInfo = { auth, credentials };
    const aliases = params.aliases[provider];
    if (aliases && aliases.length > 0) info.aliases = aliases;
    out[provider] = info;
  }

  return out;
};

const writeJson = (outPath: string, payload: unknown) => {
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const ensureDir = (p: string) => fs.mkdirSync(p, { recursive: true });

const ensureOpenclawDeps = (src: string) => {
  const zodPkg = path.join(src, "node_modules", "zod", "package.json");
  if (!fs.existsSync(zodPkg)) {
    console.error(`error: missing openclaw dependencies in ${src}`);
    console.error("hint: run `pnpm install --frozen-lockfile --ignore-scripts` in the openclaw source first");
    process.exit(1);
  }
};

function isValidSchemaArtifact(input: OpenclawSchemaArtifact): boolean {
  return Boolean(
    input &&
      typeof input === "object" &&
      input.schema &&
      typeof input.schema === "object" &&
      input.uiHints &&
      typeof input.uiHints === "object" &&
      typeof input.version === "string" &&
      input.version.trim() &&
      typeof input.openclawRev === "string" &&
      input.openclawRev.trim(),
  );
}

function syncSchemaAsset(params: { schemaSource: string; schemaOut: string }): void {
  if (!fs.existsSync(params.schemaSource)) {
    console.error(`error: missing pinned openclaw schema: ${params.schemaSource}`);
    console.error("hint: run `nix run .#update-openclaw-schema` first");
    process.exit(1);
  }
  const schemaArtifact = readJson<OpenclawSchemaArtifact>(params.schemaSource);
  if (!isValidSchemaArtifact(schemaArtifact)) {
    console.error(`error: invalid pinned openclaw schema payload: ${params.schemaSource}`);
    process.exit(1);
  }
  writeJson(params.schemaOut, schemaArtifact);
}

const main = async () => {
  const src = argValue("--src") ?? process.env.OPENCLAW_SRC;
  const schemaSource =
    argValue("--schema-source") ??
    path.join(repoRoot, "packages", "core", "src", "generated", "openclaw-config.schema.json");
  const schemaOut =
    argValue("--schema-out") ?? path.join(repoRoot, "packages", "core", "src", "assets", "openclaw-config.schema.json");
  const providersOut =
    argValue("--providers-out") ??
    path.join(repoRoot, "packages", "core", "src", "assets", "llm-providers.json");

  ensureDir(path.dirname(schemaOut));
  ensureDir(path.dirname(providersOut));

  syncSchemaAsset({
    schemaSource: path.resolve(schemaSource),
    schemaOut: path.resolve(schemaOut),
  });

  if (!src) {
    console.error("error: missing --src <openclaw repo path> (or set OPENCLAW_SRC)");
    process.exit(1);
  }

  const sourceDir = path.resolve(src);
  ensureOpenclawDeps(sourceDir);

  const modelAuthText = readText(path.join(sourceDir, "src", "agents", "model-auth.ts"));
  const modelSelectionText = readText(path.join(sourceDir, "src", "agents", "model-selection.ts"));
  const envText = readText(path.join(sourceDir, "src", "infra", "env.ts"));
  const envMap = parseEnvMap({
    text: modelAuthText,
    sourcePath: path.join(sourceDir, "src", "agents", "model-auth.ts"),
  });
  const aliases = parseProviderAliases({
    text: modelSelectionText,
    sourcePath: path.join(sourceDir, "src", "agents", "model-selection.ts"),
  });
  const envAliases = parseEnvAliases(envText);
  for (const [provider, envs] of Object.entries(envMap)) {
    const expanded = new Set(envs);
    for (const envVar of envs) {
      const more = envAliases[envVar];
      if (!more) continue;
      for (const alias of more) expanded.add(alias);
    }
    envMap[provider] = Array.from(expanded);
  }

  const oauthProviders = await readOAuthProviders(sourceDir);

  const providerInfo = buildProviderInfo({ envMap, aliases, oauthProviders });
  writeJson(path.resolve(providersOut), providerInfo);

  console.log(`ok: wrote ${path.relative(repoRoot, path.resolve(schemaOut))}`);
  console.log(`ok: wrote ${path.relative(repoRoot, path.resolve(providersOut))}`);
};

main().catch((err) => {
  console.error(`error: ${String((err as Error)?.message || err)}`);
  process.exit(1);
});
