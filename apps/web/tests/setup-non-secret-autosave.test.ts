import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup non-secret autosave", () => {
  it("autosaves pending infrastructure and connection state via setupDraftSaveNonSecret", () => {
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")
    const deploySetup = readFile("components/deploy/deploy-initial-setup.tsx")

    expect(setupRoute).toContain("NON_SECRET_AUTOSAVE_DEBOUNCE_MS")
    expect(setupRoute).toContain("normalizeNonSecretPatch")
    expect(setupRoute).toContain("setupDraftSaveNonSecret")
    expect(setupRoute).toContain("saveNonSecretDraftMutation")
    expect(setupRoute).toContain("saveNonSecretDraftMutate(pendingNonSecretPatch)")

    expect(deploySetup).toContain("const savedNonSecretDraft = await setupDraftSaveNonSecret({")
    expect(deploySetup).not.toContain("expectedVersion: props.setupDraft?.version")
  })
})
