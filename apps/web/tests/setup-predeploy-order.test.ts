import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup github access order", () => {
  it("keeps git readiness first, first-push help second, and token input third with no copy button", () => {
    const creds = readFile("components/setup/steps/step-creds.tsx")
    const setupModel = readFile("lib/setup/setup-model.ts")
    const deployCredsCard = readFile("components/fleet/deploy-creds-card.tsx")

    expect(creds).toContain("title=\"GitHub token\"")
    expect(creds).toContain("githubReadiness={githubReadiness}")
    expect(creds).toContain("githubFirstPushGuidance={githubFirstPushGuidance}")
    expect(setupModel).toContain('"creds"')
    expect(setupModel.indexOf('"tailscale-lockdown"')).toBeLessThan(setupModel.indexOf('"creds"'))
    expect(setupModel.indexOf('"creds"')).toBeLessThan(setupModel.indexOf('"deploy"'))

    expect(deployCredsCard.indexOf("Git push readiness")).toBeLessThan(deployCredsCard.indexOf("First push help"))
    expect(deployCredsCard.indexOf("First push help")).toBeLessThan(
      deployCredsCard.indexOf("placeholder={githubTokenRequired ? \"Required\" : \"Recommended\"}"),
    )
    expect(deployCredsCard).not.toContain("Copy commands")
  })
})
