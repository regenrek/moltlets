import { describe, expect, it } from "vitest"
import { shouldDisableSave } from "~/components/fleet/bot/gateway-openclaw-editor"

describe("gateway openclaw editor save gating", () => {
  it("disables save when schema errors present", () => {
    expect(
      shouldDisableSave({
        canEdit: true,
        saving: false,
        parsedOk: true,
        hasSchemaErrors: true,
      }),
    ).toBe(true)
  })

  it("allows save when valid and no errors", () => {
    expect(
      shouldDisableSave({
        canEdit: true,
        saving: false,
        parsedOk: true,
        hasSchemaErrors: false,
      }),
    ).toBe(false)
  })
})
