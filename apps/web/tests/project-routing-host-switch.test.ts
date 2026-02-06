import { describe, expect, it } from "vitest"
import { buildHostSwitchPath } from "../src/lib/project-routing"

describe("buildHostSwitchPath (global ~ mapping)", () => {
  it("maps /~/deploy to /hosts/<host>/deploy", () => {
    expect(
      buildHostSwitchPath({
        projectSlug: "mj-clawlets-3",
        host: "mj-clawlets-3",
        pathname: "/mj-clawlets-3/~/deploy",
      }),
    ).toBe("/mj-clawlets-3/hosts/mj-clawlets-3/deploy")
  })

  it("maps /~/settings to /hosts/<host>/settings", () => {
    expect(
      buildHostSwitchPath({
        projectSlug: "mj-clawlets-3",
        host: "mj-clawlets-3",
        pathname: "/mj-clawlets-3/~/settings",
      }),
    ).toBe("/mj-clawlets-3/hosts/mj-clawlets-3/settings")
  })

  it("maps legacy /~/bootstrap and /~/updates to /hosts/<host>/deploy", () => {
    for (const pathname of ["/mj-clawlets-3/~/bootstrap", "/mj-clawlets-3/~/updates"]) {
      expect(
        buildHostSwitchPath({
          projectSlug: "mj-clawlets-3",
          host: "mj-clawlets-3",
          pathname,
        }),
      ).toBe("/mj-clawlets-3/hosts/mj-clawlets-3/deploy")
    }
  })
})

