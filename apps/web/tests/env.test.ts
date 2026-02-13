import { afterEach, describe, expect, it } from "vitest"

import { assertAuthEnv, hasAuthEnv as hasWebAuthEnv } from "../src/server/env"
import { hasAuthEnv as hasConvexAuthEnv } from "../convex/shared/env"

const envKeys = [
  "NODE_ENV",
  "CONVEX_DEPLOYMENT",
  "SITE_URL",
  "BETTER_AUTH_SECRET",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
  "CONVEX_SITE_URL",
] as const

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("server env", () => {
  it("requires all web auth env vars", () => {
    delete process.env["SITE_URL"]
    delete process.env["BETTER_AUTH_SECRET"]
    delete process.env["VITE_CONVEX_URL"]
    delete process.env["VITE_CONVEX_SITE_URL"]
    expect(hasWebAuthEnv()).toBe(false)

    process.env["SITE_URL"] = "http://localhost:3000"
    process.env["BETTER_AUTH_SECRET"] = "secret"
    process.env["VITE_CONVEX_URL"] = "https://example.convex.cloud"
    process.env["VITE_CONVEX_SITE_URL"] = "https://example.convex.site"
    expect(hasWebAuthEnv()).toBe(true)
  })

  it("accepts CONVEX_* fallbacks when VITE_* vars are unset", () => {
    process.env["SITE_URL"] = "https://app.example.com"
    process.env["BETTER_AUTH_SECRET"] = "secret"
    delete process.env["VITE_CONVEX_URL"]
    delete process.env["VITE_CONVEX_SITE_URL"]
    process.env["CONVEX_URL"] = "https://example.convex.cloud"
    process.env["CONVEX_SITE_URL"] = "https://example.convex.site"

    expect(hasWebAuthEnv()).toBe(true)
  })

  it("assertAuthEnv throws when required vars are missing", () => {
    delete process.env["SITE_URL"]
    delete process.env["BETTER_AUTH_SECRET"]
    delete process.env["VITE_CONVEX_URL"]
    delete process.env["VITE_CONVEX_SITE_URL"]
    delete process.env["CONVEX_URL"]
    delete process.env["CONVEX_SITE_URL"]

    expect(() => assertAuthEnv()).toThrow(/missing SITE_URL, BETTER_AUTH_SECRET, VITE_CONVEX_URL, VITE_CONVEX_SITE_URL/i)
  })

  it("assertAuthEnv passes with complete auth env", () => {
    process.env["SITE_URL"] = "https://app.example.com"
    process.env["BETTER_AUTH_SECRET"] = "secret"
    process.env["VITE_CONVEX_URL"] = "https://example.convex.cloud"
    process.env["VITE_CONVEX_SITE_URL"] = "https://example.convex.site"

    expect(() => assertAuthEnv()).not.toThrow()
  })
})

describe("convex env", () => {
  it("requires server auth env vars", () => {
    delete process.env["SITE_URL"]
    delete process.env["BETTER_AUTH_SECRET"]
    expect(hasConvexAuthEnv()).toBe(false)

    process.env["SITE_URL"] = "http://localhost:3000"
    process.env["BETTER_AUTH_SECRET"] = "secret"
    expect(hasConvexAuthEnv()).toBe(true)
  })
})
