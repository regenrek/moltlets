export type ConnectionStepRequirementsInput = {
  host: string
  adminCidr: string
  hasProjectSshKeys: boolean
  keyText: string
}

export function resolveConnectionStepMissingRequirements(input: ConnectionStepRequirementsInput): string[] {
  const missing: string[] = []
  if (!input.host.trim()) missing.push("host")
  if (!input.adminCidr.trim()) missing.push("admin IP (CIDR)")
  if (!input.hasProjectSshKeys && !input.keyText.trim()) missing.push("SSH public key")
  return missing
}

export function shouldShowConnectionSshKeyEditor(input: {
  hasProjectSshKeys: boolean
  showKeyEditor: boolean
  keyText: string
}): boolean {
  if (!input.hasProjectSshKeys) return true
  if (input.showKeyEditor) return true
  return Boolean(input.keyText.trim())
}
