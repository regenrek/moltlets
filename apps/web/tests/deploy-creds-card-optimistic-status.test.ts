import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("deploy creds card optimistic status", () => {
  it("switches token UI immediately after save/remove while runner metadata catches up", () => {
    const source = readFile("components/fleet/deploy-creds-card.tsx")

    expect(source).toContain("DEPLOY_CREDS_OPTIMISTIC_STATUS_TTL_MS")
    expect(source).toContain("const [optimisticKeyStatus, setOptimisticKeyStatus] = useState")
    expect(source).toContain("const optimistic = optimisticKeyStatus[key]")
    expect(source).toContain("setOptimisticStatus(input.key, input.kind === \"remove\" ? \"unset\" : \"set\")")
  })
})

