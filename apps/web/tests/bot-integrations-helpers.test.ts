import { describe, expect, it } from "vitest"
import { readInlineSecretWarnings } from "../src/components/fleet/integrations/helpers"

describe("bot integrations helpers", () => {
  it("warns on inline channel tokens via metadata", () => {
    const warnings = readInlineSecretWarnings({
      channels: {
        discord: { token: "discord-inline" },
        telegram: { botToken: "telegram-inline" },
        slack: { botToken: "slack-inline", appToken: "slack-app-inline" },
      },
    })

    expect(warnings.join("\n")).toContain("DISCORD_BOT_TOKEN")
    expect(warnings.join("\n")).toContain("TELEGRAM_BOT_TOKEN")
    expect(warnings.join("\n")).toContain("SLACK_BOT_TOKEN")
    expect(warnings.join("\n")).toContain("SLACK_APP_TOKEN")
  })

  it("skips warnings for env-var references", () => {
    const warnings = readInlineSecretWarnings({
      channels: {
        discord: { token: "${DISCORD_BOT_TOKEN}" },
        telegram: { botToken: "${TELEGRAM_BOT_TOKEN}" },
      },
    })

    expect(warnings.length).toBe(0)
  })
})
