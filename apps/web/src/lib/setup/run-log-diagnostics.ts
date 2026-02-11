export type RunLogDiagnosticSeverity = "info" | "warning" | "error"

export type RunLogDiagnostic = {
  id: string
  severity: RunLogDiagnosticSeverity
  title: string
  description: string
  detail?: string
}

function extractFirstMatch(input: string, re: RegExp): string | null {
  const match = re.exec(input)
  return match?.[1] ? String(match[1]) : null
}

function extractHostFromNixMissingAttribute(line: string): string | null {
  return (
    extractFirstMatch(line, /nixosConfigurations\."([^"]+)"/)
    || extractFirstMatch(line, /nixosConfigurations\\\.\\"([^\\"]+)\\"/)
  )
}

export function deriveRunLogDiagnostics(messages: string[]): RunLogDiagnostic[] {
  const lines = messages
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  const diagnostics: RunLogDiagnostic[] = []

  const missingAttrLine = lines.find((l) =>
    l.includes("does not provide attribute")
    && l.includes("nixosConfigurations")
    && l.includes("config.nix.settings.substituters"))
  if (missingAttrLine) {
    const flake = extractFirstMatch(missingAttrLine, /flake '([^']+)'/)
    const host = extractHostFromNixMissingAttribute(missingAttrLine)
    diagnostics.push({
      id: "nix_flake_missing_host_attr",
      severity: "error",
      title: "Deploy pinned to a revision missing this host",
      description: host
        ? `The flake does not export nixosConfigurations.${host} at the pinned revision.`
        : "The flake does not export this host at the pinned revision.",
      detail: [
        "Fix: commit and push your host config, then retry deploy.",
        "If this host is new: ensure fleet/clawlets.json includes it.",
        flake ? `Pinned flake: ${flake}` : null,
      ].filter(Boolean).join(" "),
    })
  }

  const sshOpenLine = lines.find((l) => l.includes("SSH WILL REMAIN OPEN") || l.includes("SSH exposure: bootstrap"))
  if (sshOpenLine) {
    diagnostics.push({
      id: "ssh_exposure_bootstrap",
      severity: "warning",
      title: "SSH can remain publicly exposed",
      description: "Bootstrap mode can leave port 22 open until you switch SSH exposure to tailnet and run lockdown.",
      detail: "If you cannot use tailnet yet, treat the host as publicly reachable until exposure is switched.",
    })
  }

  const missingHostKeyLine = lines.find((l) => l.includes("Cannot read ssh key '/etc/ssh/ssh_host_"))
  if (missingHostKeyLine) {
    diagnostics.push({
      id: "ssh_host_keys_missing",
      severity: "info",
      title: "SSH host keys missing during install",
      description: "Install logs mention missing /etc/ssh/ssh_host_* keys.",
      detail: "This can be normal in minimal images (keys generated on first boot). If SSH fails, check sshd status and /etc/ssh on the host.",
    })
  }

  return diagnostics.slice(0, 3)
}
