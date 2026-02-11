import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const FILE_PATH = path.resolve(
  process.cwd(),
  "src/routes/$projectSlug/hosts/$host/gateways/$gatewayId/settings.tsx",
)

describe("gateway settings viewer access", () => {
  it("shows explicit admin message and avoids config query for viewers", () => {
    const source = fs.readFileSync(FILE_PATH, "utf8")
    expect(source).toContain("Admin access required to view gateway config.")
    expect(source).toContain("enabled: Boolean(projectId) && canQuery && canEdit")
  })
})
