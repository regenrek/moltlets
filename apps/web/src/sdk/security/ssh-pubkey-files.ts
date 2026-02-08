import { createServerFn } from "@tanstack/react-start"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type DetectSshPubkeyFilesResult =
  | { ok: true; files: string[]; baseDir: string }
  | { ok: false; message: string }

function sortPubkeyFiles(a: string, b: string): number {
  const priority = (p: string) => {
    const base = path.basename(p)
    if (base === "id_ed25519.pub") return 0
    if (base === "id_ecdsa.pub") return 1
    if (base === "id_rsa.pub") return 2
    return 10
  }
  const pa = priority(a)
  const pb = priority(b)
  if (pa !== pb) return pa - pb
  return a.localeCompare(b)
}

export const detectLocalSshPubkeyFiles = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const home = os.homedir()
    if (!home) return { ok: false, message: "Could not resolve home directory." } satisfies DetectSshPubkeyFilesResult

    const sshDir = path.join(home, ".ssh")
    if (!fs.existsSync(sshDir)) {
      return { ok: true, files: [], baseDir: "~/.ssh" } satisfies DetectSshPubkeyFilesResult
    }

    const entries = fs.readdirSync(sshDir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".pub"))
      .map((e) => `~/.ssh/${e.name}`)
      .toSorted(sortPubkeyFiles)

    return { ok: true, files, baseDir: "~/.ssh" } satisfies DetectSshPubkeyFilesResult
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    } satisfies DetectSshPubkeyFilesResult
  }
})

