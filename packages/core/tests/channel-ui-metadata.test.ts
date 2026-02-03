import { describe, expect, it } from "vitest"
import { getPinnedChannelUiModel, listPinnedChannelUiModels } from "../src/lib/channel-ui-metadata"

describe("channel ui metadata", () => {
  it("exposes allowFrom for telegram + whatsapp", () => {
    const telegram = getPinnedChannelUiModel("telegram")
    const whatsapp = getPinnedChannelUiModel("whatsapp")
    const discord = getPinnedChannelUiModel("discord")
    expect(telegram?.allowFrom).toBe(true)
    expect(whatsapp?.allowFrom).toBe(true)
    expect(discord?.allowFrom).toBe(false)
  })

  it("builds metadata for all pinned channels", () => {
    const entries = listPinnedChannelUiModels()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(typeof entry.id).toBe("string")
      expect(entry.id.length).toBeGreaterThan(0)
      expect(typeof entry.name).toBe("string")
    }
  })
})
