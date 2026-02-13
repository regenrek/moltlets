import { describe, expect, it } from "vitest"
import { HETZNER_DEFAULT_LOCATION, HETZNER_DEFAULT_SERVER_TYPE } from "@clawlets/core/lib/config/providers/hetzner"
import {
  HETZNER_LOCATION_OPTIONS,
  HETZNER_SERVER_TYPE_OPTIONS,
  HETZNER_SETUP_DEFAULT_LOCATION,
  HETZNER_SETUP_DEFAULT_SERVER_TYPE,
  isKnownHetznerLocation,
  isKnownHetznerServerType,
} from "../src/components/hosts/hetzner-options"

describe("hetzner options defaults", () => {
  it("stays aligned with core defaults", () => {
    expect(HETZNER_SETUP_DEFAULT_SERVER_TYPE).toBe(HETZNER_DEFAULT_SERVER_TYPE)
    expect(HETZNER_SETUP_DEFAULT_LOCATION).toBe(HETZNER_DEFAULT_LOCATION)
  })

  it("contains default selections in preset options", () => {
    expect(HETZNER_SERVER_TYPE_OPTIONS.some((option) => option.value === HETZNER_SETUP_DEFAULT_SERVER_TYPE)).toBe(true)
    expect(HETZNER_LOCATION_OPTIONS.some((option) => option.value === HETZNER_SETUP_DEFAULT_LOCATION)).toBe(true)
  })

  it("orders server presets for human-centric sizing while keeping cpx32 default", () => {
    expect(HETZNER_SERVER_TYPE_OPTIONS.map((option) => option.value)).toEqual(["cpx22", "cpx32", "cpx42"])
    expect(HETZNER_SERVER_TYPE_OPTIONS[0]?.title).toContain("Starter")
    expect(HETZNER_SERVER_TYPE_OPTIONS[1]?.title).toContain("Balanced")
    expect(HETZNER_SERVER_TYPE_OPTIONS[2]?.title).toContain("Heavy")
    expect(HETZNER_SETUP_DEFAULT_SERVER_TYPE).toBe("cpx32")
  })

  it("validates known vs custom values", () => {
    expect(isKnownHetznerServerType("cpx32")).toBe(true)
    expect(isKnownHetznerServerType("cpx22")).toBe(true)
    expect(isKnownHetznerServerType("cx43")).toBe(false)
    expect(isKnownHetznerLocation("fsn1")).toBe(true)
    expect(isKnownHetznerLocation("nbg99")).toBe(false)
  })
})
