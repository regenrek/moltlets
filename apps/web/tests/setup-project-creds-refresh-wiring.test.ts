import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(process.cwd(), "src")

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8")
}

describe("setup project creds refresh wiring", () => {
  it("requests model refresh after setup-step credential writes queue", () => {
    const infra = readFile("components/setup/steps/step-infrastructure.tsx")
    const tailscale = readFile("components/setup/steps/step-tailscale-lockdown.tsx")
    const setupRoute = readFile("routes/$projectSlug/hosts/$host/setup.tsx")
    const setupModel = readFile("lib/setup/use-setup-model.ts")
    const deployCredsCard = readFile("components/fleet/deploy-creds-card.tsx")
    const keyringCard = readFile("components/setup/project-token-keyring-card.tsx")

    expect(infra).toContain("onQueued={props.onProjectCredsQueued}")
    expect(tailscale).toContain("onQueued={props.onProjectCredsQueued}")
    expect(setupRoute).toContain("onProjectCredsQueued={setup.refreshDeployCredsStatus}")
    expect(setupModel).toContain("DEPLOY_CREDS_RECONCILE_DELAYS_MS")
    expect(setupModel).toContain("refreshDeployCredsStatus")
    expect(deployCredsCard).toContain("onQueued?.()")
    expect(keyringCard).toContain("props.onQueued?.()")
  })
})
