import { describe, expect, it } from "vitest"

import { orderBootstrapRunsForIpv4 } from "~/lib/host/bootstrap-ipv4-selection"

type Row = {
  id: string
  kind?: string | null
  status?: string | null
}

describe("orderBootstrapRunsForIpv4", () => {
  it("prioritizes succeeded bootstrap runs over running and queued", () => {
    const rows: Row[] = [
      { id: "custom-running", kind: "custom", status: "running" },
      { id: "bootstrap-running", kind: "bootstrap", status: "running" },
      { id: "bootstrap-succeeded", kind: "bootstrap", status: "succeeded" },
      { id: "bootstrap-queued", kind: "bootstrap", status: "queued" },
      { id: "bootstrap-failed", kind: "bootstrap", status: "failed" },
    ]

    const ordered = orderBootstrapRunsForIpv4(rows).map((row) => row.id)
    expect(ordered).toEqual([
      "bootstrap-succeeded",
      "bootstrap-running",
      "bootstrap-queued",
      "bootstrap-failed",
    ])
  })

  it("keeps original order within same status bucket", () => {
    const rows: Row[] = [
      { id: "s1", kind: "bootstrap", status: "succeeded" },
      { id: "s2", kind: "bootstrap", status: "succeeded" },
      { id: "r1", kind: "bootstrap", status: "running" },
      { id: "r2", kind: "bootstrap", status: "running" },
    ]

    const ordered = orderBootstrapRunsForIpv4(rows).map((row) => row.id)
    expect(ordered).toEqual(["s1", "s2", "r1", "r2"])
  })
})
