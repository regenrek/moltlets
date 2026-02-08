import fs from "node:fs/promises";
import path from "node:path";

export function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : "";
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function backupFile(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) return null;
  const backupPath = `${filePath}.bak.${isoTimestamp()}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function fsyncDirectory(dir: string): Promise<void> {
  const handle = await fs.open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readExistingMode(filePath: string): Promise<number | undefined> {
  try {
    const existing = await fs.stat(filePath);
    return existing.mode & 0o777;
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : "";
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
}

export async function writeFileAtomic(
  filePath: string,
  contents: string,
  opts: { mode?: number } = {},
): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const mode = typeof opts.mode === "number" ? opts.mode : await readExistingMode(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  let tmpCreated = false;
  try {
    const handle = await fs.open(tmp, "w", mode);
    tmpCreated = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (typeof mode === "number") {
      try {
        await fs.chmod(tmp, mode);
      } catch {
        // best-effort on platforms without POSIX perms
      }
    }
    await fs.rename(tmp, filePath);
    await fsyncDirectory(dir);
  } catch (err) {
    if (tmpCreated) {
      try {
        await fs.unlink(tmp);
      } catch {
        // best-effort cleanup
      }
    }
    throw err;
  }
}
