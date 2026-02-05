import process from "node:process";
import { defineCommand } from "citty";
async function loadPlugins() {
  return await import("../../lib/plugins.js");
}

function resolveSlug(args: any): string {
  const raw = String(args.name || args._?.[0] || "").trim();
  if (!raw) throw new Error("missing plugin name (pass --name or first arg)");
  return raw;
}

const list = defineCommand({
  meta: { name: "list", description: "List installed plugins." },
  args: {
    json: { type: "boolean", description: "Output JSON.", default: false },
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
  },
  async run({ args }) {
    const { listInstalledPlugins } = await loadPlugins();
    const errors: { slug: string; error: Error }[] = [];
    const plugins = listInstalledPlugins({
      cwd: process.cwd(),
      runtimeDir: args.runtimeDir as string | undefined,
      onError: (err) => errors.push(err),
    });
    const payload = { plugins, errors: errors.map((e) => ({ slug: e.slug, error: e.error.message })) };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    for (const err of errors) {
      console.error(`warn: skipping plugin ${err.slug}: ${err.error.message}`);
    }
    if (plugins.length === 0) {
      console.log("ok: no plugins installed");
      return;
    }
    for (const p of plugins) {
      console.log(`${p.command}\t${p.packageName}@${p.version}`);
    }
  },
});

const add = defineCommand({
  meta: { name: "add", description: "Install a plugin into .clawlets/plugins." },
  args: {
    name: { type: "string", description: "Plugin name (e.g. cattle)." },
    package: { type: "string", description: "Package to install (default: @clawlets/plugin-<name>)." },
    version: { type: "string", description: "Package version/tag (default: latest)." },
    allowThirdParty: { type: "boolean", description: "Allow third-party plugins (unsafe).", default: false },
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
  },
  async run({ args }) {
    const slug = resolveSlug(args);
    const packageName = String(args.package || `@clawlets/plugin-${slug}`).trim();
    if (!args.allowThirdParty && !packageName.startsWith("@clawlets/")) {
      throw new Error("third-party plugins disabled (pass --allow-third-party to override)");
    }
    const { installPlugin } = await loadPlugins();
    const plugin = await installPlugin({
      cwd: process.cwd(),
      runtimeDir: args.runtimeDir as string | undefined,
      slug,
      packageName,
      version: args.version as string | undefined,
      allowThirdParty: args.allowThirdParty as boolean | undefined,
    });
    console.log(`ok: installed ${plugin.command} (${plugin.packageName}@${plugin.version})`);
  },
});

const rm = defineCommand({
  meta: { name: "rm", description: "Remove an installed plugin." },
  args: {
    name: { type: "string", description: "Plugin name (e.g. cattle)." },
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
  },
  async run({ args }) {
    const slug = resolveSlug(args);
    const { removePlugin } = await loadPlugins();
    removePlugin({ cwd: process.cwd(), runtimeDir: args.runtimeDir as string | undefined, slug });
    console.log(`ok: removed ${slug}`);
  },
});

export const plugin = defineCommand({
  meta: { name: "plugin", description: "Plugin manager (install/remove/list)." },
  subCommands: {
    add,
    list,
    rm,
  },
});
