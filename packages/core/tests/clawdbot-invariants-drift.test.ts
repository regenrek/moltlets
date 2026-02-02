import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

describe("openclaw invariants drift", () => {
  it("keeps TS + Nix invariants specs in sync", () => {
    const tsPath = path.resolve(__dirname, "../src/assets/openclaw-invariants.json")
    const nixPath = path.resolve(__dirname, "../../..", "nix/lib/openclaw-invariants.json")
    expect(readJson(tsPath)).toEqual(readJson(nixPath))
  })
})

