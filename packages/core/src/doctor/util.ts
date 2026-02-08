import path from "node:path";
import type { ConfigStore } from "../lib/storage/config-store.js";
import { FileSystemConfigStore } from "../lib/storage/fs-config-store.js";

const defaultStore = new FileSystemConfigStore();

function requireReadDir(store: ConfigStore): NonNullable<ConfigStore["readDir"]> {
  if (!store.readDir) {
    throw new Error("ConfigStore.readDir is required for doctor directory scans");
  }
  return store.readDir.bind(store);
}

export async function dirHasAnyFile(dirPath: string, store: ConfigStore = defaultStore): Promise<boolean> {
  const st = await store.stat(dirPath);
  if (!st) return false;
  if (!st.isDirectory) return true;

  const readDir = requireReadDir(store);
  const entries = await readDir(dirPath);
  for (const entry of entries) {
    const p0 = path.join(dirPath, entry.name);
    if (entry.isFile || entry.isSymbolicLink) return true;
    if (entry.isDirectory && (await dirHasAnyFile(p0, store))) return true;
  }
  return false;
}

export async function resolveTemplateRoot(repoRoot: string, store: ConfigStore = defaultStore): Promise<string | null> {
  const env = String(process.env["CLAWLETS_TEMPLATE_DIR"] || "").trim();
  if (env) {
    const resolved = path.resolve(env);
    if (await store.exists(resolved)) return resolved;
  }

  const local = path.join(repoRoot, "packages", "template", "dist", "template");
  if (await store.exists(local)) return local;
  return null;
}

export async function loadKnownBundledSkills(
  repoRoot: string,
  templateRoot?: string | null,
  store: ConfigStore = defaultStore,
): Promise<{ ok: boolean; skills: string[]; errors: string[] }> {
  const repoPath = path.join(repoRoot, "fleet", "bundled-skills.json");
  const tplPath = templateRoot ? path.join(templateRoot, "fleet", "bundled-skills.json") : null;

  const errors: string[] = [];

  let repoText = "";
  let tplText = "";

  try {
    if (!(await store.exists(repoPath))) throw new Error(`missing: ${repoPath}`);
    repoText = await store.readText(repoPath);
  } catch (e) {
    errors.push(String((e as Error)?.message || e));
  }

  if (tplPath) {
    try {
      if (!(await store.exists(tplPath))) throw new Error(`missing: ${tplPath}`);
      tplText = await store.readText(tplPath);
    } catch (e) {
      errors.push(String((e as Error)?.message || e));
    }
  }

  if (repoText && tplText && repoText.trim() !== tplText.trim()) {
    const label = tplPath ? path.relative(repoRoot, tplPath) : "template";
    errors.push(`bundled skills mismatch: fleet/bundled-skills.json must match ${label}`);
  }

  if (!repoText) return { ok: false, skills: [], errors };

  try {
    const parsed = JSON.parse(repoText) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      errors.push("fleet/bundled-skills.json must be a JSON array of strings");
      return { ok: false, skills: [], errors };
    }

    const cleaned = parsed.map((s) => s.trim()).filter(Boolean);
    const uniq = Array.from(new Set(cleaned));
    if (uniq.length === 0) errors.push("fleet/bundled-skills.json must not be empty");
    return { ok: errors.length === 0, skills: uniq, errors };
  } catch (e) {
    errors.push(`invalid JSON: fleet/bundled-skills.json (${String((e as Error)?.message || e)})`);
    return { ok: false, skills: [], errors };
  }
}
