import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findRepoRoot } from "@clawlets/core/lib/repo";
import { run } from "@clawlets/core/lib/run";
import { getRepoLayout } from "@clawlets/core/repo-layout";
import { baseCommandNames } from "../commands/registry.js";

const PLUGIN_MANIFEST = "clawlets-plugin.json";
const RESERVED_COMMANDS = new Set(baseCommandNames);
const SAFE_SLUG_RE = /^[a-z][a-z0-9_-]*$/;
const PACKAGE_NAME_RE =
  /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/;

export type InstalledPlugin = {
  slug: string;
  packageName: string;
  version: string;
  command: string;
  entry: string;
  installDir: string;
  packageDir: string;
};

export type PluginScanError = {
  slug: string;
  error: Error;
};

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function assertSafeSlug(value: string): void {
  if (!SAFE_SLUG_RE.test(value)) {
    throw new Error(`invalid plugin command: ${value} (expected [a-z][a-z0-9_-]*)`);
  }
}

function isReservedCommand(value: string): boolean {
  return RESERVED_COMMANDS.has(value);
}

function assertCommandName(value: string): void {
  assertSafeSlug(value);
  if (isReservedCommand(value)) {
    throw new Error(`plugin command reserved: ${value}`);
  }
}

function resolvePluginsDir(params: { cwd: string; runtimeDir?: string }): string {
  const repoRoot = findRepoRoot(params.cwd);
  return getRepoLayout(repoRoot, params.runtimeDir).pluginsDir;
}

function resolveInstallDir(params: { pluginsDir: string; slug: string }): string {
  return path.join(params.pluginsDir, params.slug);
}

function resolvePackageDir(params: { installDir: string; packageName: string }): string {
  return path.join(params.installDir, "node_modules", ...params.packageName.split("/"));
}

function readPluginPackageMeta(packageDir: string): { command: string; entry: string } {
  const pkgPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`plugin package.json missing: ${pkgPath}`);
  }
  const pkg = readJsonFile<{ clawlets?: { command?: unknown; entry?: unknown } }>(pkgPath);
  const command = String(pkg?.clawlets?.command || "").trim();
  const entry = String(pkg?.clawlets?.entry || "").trim();
  if (!command) throw new Error(`plugin missing clawlets.command in ${pkgPath}`);
  if (!entry) throw new Error(`plugin missing clawlets.entry in ${pkgPath}`);
  assertCommandName(command);
  return { command, entry };
}

function assertPackageName(value: string): void {
  if (!PACKAGE_NAME_RE.test(value)) {
    throw new Error(`invalid plugin package name: ${value}`);
  }
}

function resolveManifestPath(installDir: string): string {
  return path.join(installDir, PLUGIN_MANIFEST);
}

function normalizeManifest(
  slug: string,
  manifest: Omit<InstalledPlugin, "installDir" | "packageDir">,
): Omit<InstalledPlugin, "installDir" | "packageDir"> {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("plugin manifest invalid");
  }
  const packageName = String((manifest as any).packageName || "").trim();
  const version = String((manifest as any).version || "").trim();
  const command = String((manifest as any).command || "").trim();
  const entry = String((manifest as any).entry || "").trim();
  if (!packageName) throw new Error("plugin manifest missing packageName");
  assertPackageName(packageName);
  if (!version) throw new Error("plugin manifest missing version");
  if (!command) throw new Error("plugin manifest missing command");
  if (!entry) throw new Error("plugin manifest missing entry");
  assertCommandName(command);
  if (command !== slug) {
    throw new Error(`plugin manifest command mismatch (expected ${slug}, got ${command})`);
  }
  return { slug, packageName, version, command, entry };
}

function readPluginManifest(installDir: string, slug: string): Omit<InstalledPlugin, "installDir" | "packageDir"> {
  const manifestPath = resolveManifestPath(installDir);
  const manifest = readJsonFile<Omit<InstalledPlugin, "installDir" | "packageDir">>(manifestPath);
  return normalizeManifest(slug, manifest);
}

function writePluginManifest(installDir: string, manifest: Omit<InstalledPlugin, "installDir" | "packageDir">): void {
  writeJsonFile(resolveManifestPath(installDir), manifest);
}

function deriveManifestFromInstall(installDir: string, slug: string): Omit<InstalledPlugin, "installDir" | "packageDir"> {
  const pkgPath = path.join(installDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`plugin install missing package.json: ${pkgPath}`);
  }
  const pkg = readJsonFile<{ dependencies?: Record<string, string> }>(pkgPath);
  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length !== 1) {
    throw new Error(`plugin install must declare exactly one dependency (found ${deps.length})`);
  }
  const packageName = deps[0] || "";
  if (!packageName) throw new Error("plugin dependency missing");
  assertPackageName(packageName);
  const packageDir = resolvePackageDir({ installDir, packageName });
  const meta = readPluginPackageMeta(packageDir);
  if (meta.command !== slug) {
    throw new Error(`plugin command mismatch: expected ${slug} got ${meta.command}`);
  }
  const pluginPkgPath = path.join(packageDir, "package.json");
  const pluginPkg = readJsonFile<{ version?: unknown }>(pluginPkgPath);
  const version = String(pluginPkg.version || "").trim();
  if (!version) throw new Error(`plugin version missing in ${pluginPkgPath}`);
  return {
    slug,
    packageName,
    version,
    command: meta.command,
    entry: meta.entry,
  };
}

export function listInstalledPlugins(params: {
  cwd: string;
  runtimeDir?: string;
  onError?: (err: PluginScanError) => void;
}): InstalledPlugin[] {
  const pluginsDir = resolvePluginsDir(params);
  if (!fs.existsSync(pluginsDir)) return [];
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const out: InstalledPlugin[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slug = ent.name;
    if (slug.startsWith(".")) continue;
    try {
      assertSafeSlug(slug);
      const installDir = resolveInstallDir({ pluginsDir, slug });
      let manifest: Omit<InstalledPlugin, "installDir" | "packageDir">;
      try {
        manifest = readPluginManifest(installDir, slug);
      } catch {
        manifest = deriveManifestFromInstall(installDir, slug);
        writePluginManifest(installDir, manifest);
      }
      const packageDir = resolvePackageDir({ installDir, packageName: manifest.packageName });
      out.push({ ...manifest, installDir, packageDir });
    } catch (error) {
      params.onError?.({ slug, error: error instanceof Error ? error : new Error(String(error)) });
      continue;
    }
  }
  return out.sort((a, b) => a.command.localeCompare(b.command));
}

export function findPluginByCommand(params: { cwd: string; runtimeDir?: string; command: string }): InstalledPlugin | null {
  const cmd = params.command.trim();
  if (!cmd || cmd.startsWith("-") || isReservedCommand(cmd)) return null;
  const plugins = listInstalledPlugins(params);
  return plugins.find((p) => p.command === cmd) || null;
}

export async function loadPluginCommand(plugin: InstalledPlugin): Promise<any> {
  const entryRel = plugin.entry.trim();
  if (!entryRel) throw new Error(`plugin entry empty for ${plugin.command}`);
  if (path.isAbsolute(entryRel)) {
    throw new Error(`plugin entry must be relative: ${entryRel}`);
  }
  if (entryRel.split(/[/\\\\]+/).includes("..")) {
    throw new Error(`plugin entry must not contain .. segments: ${entryRel}`);
  }
  const entryPath = path.resolve(plugin.packageDir, entryRel);
  const entryRelPath = path.relative(plugin.packageDir, entryPath);
  if (entryRelPath.startsWith("..") || path.isAbsolute(entryRelPath)) {
    throw new Error(`plugin entry escapes package: ${entryRel}`);
  }
  if (!fs.existsSync(entryPath)) {
    throw new Error(`plugin entry missing: ${entryPath}`);
  }
  const mod = await import(pathToFileURL(entryPath).href);
  const command = mod.command || mod.plugin?.command || mod.default?.command || mod.default;
  if (!command) throw new Error(`plugin entry ${entryPath} does not export a command`);
  return command;
}

export async function installPlugin(params: {
  cwd: string;
  runtimeDir?: string;
  slug: string;
  packageName: string;
  version?: string;
  allowThirdParty?: boolean;
}): Promise<InstalledPlugin> {
  const pluginsDir = resolvePluginsDir(params);
  const slug = params.slug.trim();
  if (!slug) throw new Error("plugin name required");
  assertCommandName(slug);

  const packageName = params.packageName.trim();
  if (!packageName) throw new Error("package name required");
  assertPackageName(packageName);
  if (!params.allowThirdParty && !packageName.startsWith("@clawlets/")) {
    throw new Error("third-party plugins disabled (pass --allow-third-party to override)");
  }

  const installDir = resolveInstallDir({ pluginsDir, slug });
  if (fs.existsSync(installDir) && fs.readdirSync(installDir).length > 0) {
    throw new Error(`plugin already installed: ${slug} (${installDir})`);
  }

  fs.mkdirSync(installDir, { recursive: true });

  const depVersion = params.version?.trim() || "latest";

  const pkgJson = {
    name: `clawlets-plugin-${slug}`,
    private: true,
    type: "module",
    description: `clawlets plugin install (${slug})`,
    dependencies: {
      [packageName]: depVersion,
    },
  };

  writeJsonFile(path.join(installDir, "package.json"), pkgJson);

  await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: installDir });

  const manifest = deriveManifestFromInstall(installDir, slug);
  writePluginManifest(installDir, manifest);

  const packageDir = resolvePackageDir({ installDir, packageName: manifest.packageName });
  return { ...manifest, installDir, packageDir };
}

export function removePlugin(params: { cwd: string; runtimeDir?: string; slug: string }): void {
  const pluginsDir = resolvePluginsDir(params);
  const slug = params.slug.trim();
  if (!slug) throw new Error("plugin name required");
  assertSafeSlug(slug);
  const installDir = resolveInstallDir({ pluginsDir, slug });
  const rel = path.relative(pluginsDir, installDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`plugin path escapes plugins dir: ${installDir}`);
  }
  if (!fs.existsSync(installDir)) {
    throw new Error(`plugin not installed: ${slug}`);
  }
  fs.rmSync(installDir, { recursive: true, force: true });
}

export function listReservedCommands(): string[] {
  return [...RESERVED_COMMANDS].sort();
}
