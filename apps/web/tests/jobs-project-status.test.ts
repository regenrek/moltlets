import { describe, expect, it } from "vitest"
import { resolveProjectStatusFromRunCompletion, resolveProjectStatusPatchOnRunCompletion } from "../convex/controlPlane/jobs"

describe("jobs project status transitions", () => {
  it("sets ready for successful project_init/import", () => {
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_init", status: "succeeded" })).toBe("ready")
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_import", status: "succeeded" })).toBe("ready")
  })

  it("sets error for failed/canceled project_init/import", () => {
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_init", status: "failed" })).toBe("error")
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_init", status: "canceled" })).toBe("error")
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_import", status: "failed" })).toBe("error")
    expect(resolveProjectStatusFromRunCompletion({ runKind: "project_import", status: "canceled" })).toBe("error")
  })

  it("ignores unrelated run kinds", () => {
    expect(resolveProjectStatusFromRunCompletion({ runKind: "bootstrap", status: "succeeded" })).toBeNull()
    expect(resolveProjectStatusFromRunCompletion({ runKind: "custom", status: "failed" })).toBeNull()
  })

  it("applies transition only when project is creating", () => {
    expect(
      resolveProjectStatusPatchOnRunCompletion({
        projectStatus: "creating",
        runKind: "project_import",
        status: "succeeded",
      }),
    ).toBe("ready")

    expect(
      resolveProjectStatusPatchOnRunCompletion({
        projectStatus: "creating",
        runKind: "project_init",
        status: "failed",
      }),
    ).toBe("error")
  })

  it("does not regress non-creating projects on late completion", () => {
    expect(
      resolveProjectStatusPatchOnRunCompletion({
        projectStatus: "ready",
        runKind: "project_import",
        status: "failed",
      }),
    ).toBeNull()

    expect(
      resolveProjectStatusPatchOnRunCompletion({
        projectStatus: "error",
        runKind: "project_init",
        status: "succeeded",
      }),
    ).toBeNull()
  })
})
