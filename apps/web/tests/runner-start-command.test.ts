import { describe, expect, it } from "vitest"
import { buildRunnerStartCommand, parseRunnerStartLogging, resolveRunnerStartRuntimeDir } from "../src/lib/setup/runner-start-command"

describe("runner start command", () => {
  it("includes info log level by default", () => {
    const command = buildRunnerStartCommand({
      projectId: "p1",
      runnerName: "runner-a",
      token: "token-1",
      repoRoot: "~/repo",
      controlPlaneUrl: "https://cp.example.com",
    })
    expect(command).toContain("--runtime-dir")
    expect(command).toContain(".clawlets/runtime/runner/p1/runner-a")
    expect(command).toContain("--log-level info")
    expect(command).not.toContain("--no-log-file")
  })

  it("includes no-log-file and fatal when no-logging is selected", () => {
    const command = buildRunnerStartCommand({
      projectId: "p1",
      runnerName: "runner-a",
      token: "token-1",
      repoRoot: "~/repo",
      controlPlaneUrl: "https://cp.example.com",
      logging: "no-logging",
    })
    expect(command).toContain("--no-log-file")
    expect(command).toContain("--log-level fatal")
  })

  it("coerces unknown logging values to default", () => {
    expect(parseRunnerStartLogging("debug")).toBe("debug")
    expect(parseRunnerStartLogging("invalid")).toBe("info")
    expect(parseRunnerStartLogging("invalid", "warn")).toBe("warn")
  })

  it("builds canonical default runtime dir segments", () => {
    expect(resolveRunnerStartRuntimeDir({ projectId: "proj 1", runnerName: "runner/alpha" })).toBe(
      "~/.clawlets/runtime/runner/proj_1/runner_alpha",
    )
  })
})
