import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("host setup layout", () => {
  it("flattens step wrappers and keeps section anchors", () => {
    const source = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(source).toContain("className=\"space-y-4 xl:min-w-0 xl:flex-1\"")
    expect(source).toContain("id={`setup-step-${step.id}`}")
    expect(source).toContain("data-step-id={step.id}")
    expect(source).toContain("className=\"scroll-mt-20\"")
    expect(source).not.toContain("className=\"not-last:mb-4 scroll-mt-20 rounded-lg border bg-card p-4 text-card-foreground\"")
    expect(source).not.toContain("<h2 className=\"text-base font-semibold\">{stepMeta(step.id).title}</h2>")
    expect(source).not.toContain("<p className=\"text-xs text-muted-foreground\">{stepMeta(step.id).description}</p>")
  })

  it("passes step status into all setup step components", () => {
    const source = readFile("routes/$projectSlug/hosts/$host/setup.tsx")
    const matches = source.match(/stepStatus=\{step\.status\}/g) ?? []
    expect(matches.length).toBe(6)
  })
})
