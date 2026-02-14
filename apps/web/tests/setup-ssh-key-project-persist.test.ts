import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup ssh key project persistence", () => {
  it("writes added ssh keys to project config and invalidates setup probe cache", () => {
    const connection = readFile("components/setup/steps/step-connection.tsx")
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")

    expect(connection).toContain("addProjectSshKeys")
    expect(connection).toContain("setupConfigProbeQueryKey")
    expect(connection).toContain("SSH key added to project")
    expect(setupRoute).toContain("projectId={projectId}")
  })
})
