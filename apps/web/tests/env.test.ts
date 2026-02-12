import { afterEach, describe, expect, it } from "vitest"

import { hasAuthEnv as hasWebAuthEnv, isAuthDisabled as isWebAuthDisabled } from "../src/server/env"
import { hasAuthEnv as hasConvexAuthEnv, isAuthDisabled as isConvexAuthDisabled } from "../convex/shared/env"

const envKeys = [
  "NODE_ENV",
  "CONVEX_DEPLOYMENT",
  "SITE_URL",
  "BETTER_AUTH_SECRET",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
  "CONVEX_SITE_URL",
  "CLAWLETS_AUTH_DISABLED",
  "VITE_CLAWLETS_AUTH_DISABLED",
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
    delete process.env["CLAWLETS_AUTH_DISABLED"]
    delete process.env["VITE_CLAWLETS_AUTH_DISABLED"]
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

  it("allows missing web auth env vars when auth is disabled", () => {
    process.env["VITE_CLAWLETS_AUTH_DISABLED"] = "true"
    delete process.env["SITE_URL"]
    delete process.env["BETTER_AUTH_SECRET"]
    delete process.env["VITE_CONVEX_URL"]
    delete process.env["VITE_CONVEX_SITE_URL"]
    expect(isWebAuthDisabled()).toBe(true)
    expect(hasWebAuthEnv()).toBe(true)
  })
})

describe("convex env", () => {
  it("requires server auth env vars", () => {
    delete process.env["CLAWLETS_AUTH_DISABLED"]
    delete process.env["SITE_URL"]
    delete process.env["BETTER_AUTH_SECRET"]
    expect(hasConvexAuthEnv()).toBe(false)

    process.env["SITE_URL"] = "http://localhost:3000"
    process.env["BETTER_AUTH_SECRET"] = "secret"
    expect(hasConvexAuthEnv()).toBe(true)
  })

  it("exposes auth-disabled flag for Convex runtime", () => {
    process.env["CLAWLETS_AUTH_DISABLED"] = "true"
    expect(isConvexAuthDisabled()).toBe(true)
  })
})
