import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd())

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("runner lease-next route contract", () => {
  it("returns the leased object (not just job) so waitApplied is preserved", () => {
    const source = readFile("convex/http.ts")
    expect(source).toContain("path: \"/runner/jobs/lease-next\"")
    expect(source).toContain("runLeaseNextWithWait")
    expect(source).toContain("return json(200, leased)")
  })
})

