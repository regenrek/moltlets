import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8")
}

describe("deploy bootstrap duplicate guard", () => {
  it("prevents duplicate bootstrap enqueue in setup deploy card", () => {
    const source = readFile("components/deploy/deploy-initial-setup.tsx")
    expect(source).toContain("if (!started.reused)")
    expect(source).toContain("latestBootstrapRunQuery")
    expect(source).toContain("const bootstrapInProgress = effectiveBootstrapStatus === \"running\"")
    expect(source).toContain("&& !bootstrapInProgress")
  })

  it("prevents duplicate bootstrap enqueue in full deploy page", () => {
    const source = readFile("components/deploy/deploy-initial.tsx")
    expect(source).toContain("if (!res.reused)")
    expect(source).toContain("bootstrapStatus !== \"running\"")
  })

  it("reuses active bootstrap run in server sdk", () => {
    const source = readFile("sdk/infra/operations.ts")
    expect(source).toContain("latestByProjectHostKind")
    expect(source).toContain("reused: true as const")
  })
})
