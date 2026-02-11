import { describe, expect, it } from "vitest"
import { deriveRunnerDialogView } from "../src/lib/setup/runner-dialog-view"

describe("deriveRunnerDialogView", () => {
  it("shows remediation content when offline", () => {
    const view = deriveRunnerDialogView("offline")
    expect(view.showRemediation).toBe(true)
    expect(view.description).toContain("offline")
  })

  it("hides remediation while connecting", () => {
    const view = deriveRunnerDialogView("connecting")
    expect(view.showRemediation).toBe(false)
    expect(view.statusHint).toContain("No action needed")
  })

  it("hides remediation when ready", () => {
    const view = deriveRunnerDialogView("ready")
    expect(view.showRemediation).toBe(false)
    expect(view.statusHint).toContain("healthy")
  })
})
