import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup github access order", () => {
  it("keeps git readiness first, first-push help second, and token input third with no copy button", () => {
    const infrastructure = readFile("components/setup/steps/step-infrastructure.tsx")
    const deployCredsCard = readFile("components/fleet/deploy-creds-card.tsx")

    expect(infrastructure).toContain("title=\"GitHub access\"")
    expect(infrastructure).toContain("githubReadiness={{")
    expect(infrastructure).toContain("githubFirstPushGuidance={githubReadiness.showFirstPushGuidance")

    expect(deployCredsCard.indexOf("Git push readiness")).toBeLessThan(deployCredsCard.indexOf("First push help"))
    expect(deployCredsCard.indexOf("First push help")).toBeLessThan(
      deployCredsCard.indexOf("placeholder={githubTokenRequired ? \"Required\" : \"Recommended\"}"),
    )
    expect(deployCredsCard).not.toContain("Copy commands")
  })
})
