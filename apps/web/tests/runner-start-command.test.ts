import { describe, expect, it } from "vitest"
import { buildRunnerStartCommand } from "../src/lib/setup/runner-start-command"

describe("buildRunnerStartCommand", () => {
  it("builds command with repo root and quoted values", () => {
    const command = buildRunnerStartCommand({
      projectId: "p123",
      runnerName: "runner'a",
      token: "tok'en",
      repoRoot: "~/runner root",
      controlPlaneUrl: "https://cp.example.com",
    })
    expect(command).toContain("mkdir -p \"$HOME\"'/runner root'")
    expect(command).toContain("  --project p123 \\")
    expect(command).toContain("  --name 'runner'\"'\"'a' \\")
    expect(command).toContain("  --token 'tok'\"'\"'en' \\")
    expect(command).toContain("  --repoRoot \"$HOME\"'/runner root' \\")
    expect(command).toContain("  --control-plane-url 'https://cp.example.com'")
  })

  it("uses placeholders when token and repo root are missing", () => {
    const command = buildRunnerStartCommand({
      projectId: "p123",
      runnerName: "",
      token: "",
      repoRoot: "",
      controlPlaneUrl: "",
    })
    expect(command).toContain("mkdir -p '<runner-repo-root>'")
    expect(command).toContain("  --name '<runner-name>' \\")
    expect(command).toContain("  --token '<runner-token>' \\")
    expect(command).toContain("  --control-plane-url '<convex-site-url>'")
  })
})
