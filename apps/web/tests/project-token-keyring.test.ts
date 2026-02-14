import { describe, expect, it } from "vitest"
import {
  maskProjectToken,
  parseProjectTokenKeyring,
  PROJECT_TOKEN_KEYRING_MAX_SERIALIZED_CHARS,
  PROJECT_TOKEN_VALUE_MAX_CHARS,
  resolveActiveProjectTokenEntry,
  serializeProjectTokenKeyring,
} from "../src/lib/project-token-keyring"

describe("project token keyring", () => {
  it("parses valid keyring JSON and drops invalid rows", () => {
    const parsed = parseProjectTokenKeyring(JSON.stringify({
      items: [
        { id: "a", label: "Alpha", value: "token-a" },
        { id: "a", label: "Duplicate", value: "token-dup" },
        { id: "", label: "Bad", value: "bad" },
        { id: "b", value: "token-b" },
      ],
    }))

    expect(parsed.items.map((row) => row.id)).toEqual(["a", "b"])
    expect(parsed.items[1]?.label).toContain("Key")
  })

  it("drops entries that exceed max token length", () => {
    const oversized = "x".repeat(PROJECT_TOKEN_VALUE_MAX_CHARS + 1)
    const parsed = parseProjectTokenKeyring(JSON.stringify({
      items: [
        { id: "too-big", label: "Too big", value: oversized },
        { id: "ok", label: "OK", value: "token-ok" },
      ],
    }))

    expect(parsed.items.map((row) => row.id)).toEqual(["ok"])
  })

  it("returns empty when serialized payload is already oversized", () => {
    const hugeRaw = "x".repeat(PROJECT_TOKEN_KEYRING_MAX_SERIALIZED_CHARS + 1)
    expect(parseProjectTokenKeyring(hugeRaw).items).toEqual([])
  })

  it("resolves active entry and falls back to first item", () => {
    const keyring = parseProjectTokenKeyring(JSON.stringify({
      items: [
        { id: "a", label: "A", value: "value-a" },
        { id: "b", label: "B", value: "value-b" },
      ],
    }))

    expect(resolveActiveProjectTokenEntry({ keyring, activeId: "b" })?.id).toBe("b")
    expect(resolveActiveProjectTokenEntry({ keyring, activeId: "missing" })?.id).toBe("a")
  })

  it("serializes normalized items and masks sensitive values for UI", () => {
    const keyring = parseProjectTokenKeyring(JSON.stringify({
      items: [{ id: "a", label: "", value: "tskey-auth-1234567890" }],
    }))
    const serialized = serializeProjectTokenKeyring(keyring)

    expect(serialized).toContain('"items"')
    expect(maskProjectToken("tskey-auth-1234567890")).toBe("tske******7890")
  })

  it("throws when serialized keyring exceeds size limit", () => {
    const keyring = {
      items: Array.from({ length: 64 }, (_, idx) => ({
        id: `key-${idx}`,
        label: `Key ${idx}`,
        value: "x".repeat(PROJECT_TOKEN_VALUE_MAX_CHARS),
      })),
    }

    expect(() => serializeProjectTokenKeyring(keyring)).toThrow(/size limit/i)
  })
})
