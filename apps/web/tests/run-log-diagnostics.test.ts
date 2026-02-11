import { describe, expect, test } from "vitest"
import { deriveRunLogDiagnostics } from "~/lib/setup/run-log-diagnostics"

describe("deriveRunLogDiagnostics", () => {
  test("detects pinned flake missing host nixosConfigurations output", () => {
    const diags = deriveRunLogDiagnostics([
      "error: flake 'github:Macherjek/keen-spiritbomb/6df3bbe1ea8aab5beddb2cdffa6ba869b4799384' does not provide attribute 'packages.aarch64-darwin.nixosConfigurations.\"brisk-orbit-59\".config.nix.settings.substituters'",
    ])
    expect(diags.some((d) => d.id === "nix_flake_missing_host_attr" && d.severity === "error")).toBe(true)
    const row = diags.find((d) => d.id === "nix_flake_missing_host_attr")
    expect(row?.description).toContain("brisk-orbit-59")
    expect(row?.detail).toContain("Pinned flake")
  })

  test("detects SSH exposure warning from logs", () => {
    const diags = deriveRunLogDiagnostics([
      "⚠ SSH WILL REMAIN OPEN until you switch to tailnet and run lockdown:",
    ])
    expect(diags.some((d) => d.id === "ssh_exposure_bootstrap" && d.severity === "warning")).toBe(true)
  })
})
