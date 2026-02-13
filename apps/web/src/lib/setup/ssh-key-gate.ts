export type SshKeyGateUi = {
  blocked: boolean
  variant: "default" | "destructive"
  title: string | null
  message: string | null
}

export function deriveSshKeyGateUi(params: {
  runnerOnline: boolean
  hasDesiredSshKeys: boolean
  probePending: boolean
  probeError: boolean
}): SshKeyGateUi {
  if (!params.runnerOnline) {
    return { blocked: false, variant: "default", title: null, message: null }
  }
  if (params.hasDesiredSshKeys) {
    return { blocked: false, variant: "default", title: null, message: null }
  }
  if (params.probePending) {
    return {
      blocked: true,
      variant: "default",
      title: "Checking SSH keys",
      message: "Checking SSH keys from repo config...",
    }
  }
  if (params.probeError) {
    return {
      blocked: true,
      variant: "destructive",
      title: "SSH key settings unavailable",
      message: "Unable to verify SSH keys from repo config right now. Add a key in Server Access and retry.",
    }
  }
  return {
    blocked: true,
    variant: "destructive",
    title: "SSH key required",
    message:
      "SSH key required before deploy. Add at least one key in Server Access. Setup uses pending/draft values until setup apply.",
  }
}

