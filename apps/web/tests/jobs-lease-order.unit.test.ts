import { describe, expect, it } from "vitest"

import { __test_orderLeaseCandidates } from "../convex/controlPlane/jobs"

describe("job lease ordering", () => {
  it("merges targeted and untargeted windows by createdAt", () => {
    const order = __test_orderLeaseCandidates({
      targeted: [
        { id: "target-2", createdAt: 30 },
        { id: "target-1", createdAt: 10 },
      ],
      untargeted: [
        { id: "untargeted-2", createdAt: 40 },
        { id: "untargeted-1", createdAt: 20 },
      ],
    })
    expect(order).toEqual(["target-1", "untargeted-1", "target-2", "untargeted-2"])
  })

  it("keeps runner-targeted jobs reachable even with deep global queue", () => {
    const untargeted = Array.from({ length: 100 }, (_row, index) => ({
      id: `untargeted-${index}`,
      createdAt: index + 1,
    }))
    const order = __test_orderLeaseCandidates({
      targeted: [{ id: "target-me", createdAt: 101 }],
      untargeted,
    })
    expect(order.includes("target-me")).toBe(true)
    expect(order[order.length - 1]).toBe("target-me")
  })
})
