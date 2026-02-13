const SAFE_ERROR_PATTERNS: RegExp[] = [
  /^nix not found/i,
  /^spawn nix enoent$/i,
  /^invalid projectid$/i,
  /^sign-in required$/i,
  /^project access denied$/i,
  /^admin required$/i,
  /^too many requests$/i,
  /^run not running$/i,
  /^run kind mismatch/i,
  /^run already active$/i,
  /^run canceled$/i,
  /^run timed out after \d+s$/i,
  /^.+ exited with code \d+$/i,
  /^missing host$/i,
  /^unknown host:/i,
  /^unknown gateway:/i,
  /^invalid target host:/i,
  /^missing targethost /i,
  /^invalid gateway port /i,
  /^schema payload missing required fields$/i,
  /^missing schema markers in output$/i,
  /^empty schema payload in output$/i,
  /^schema payload too large$/i,
  /^detached head/i,
  /^unknown branch/i,
  /^missing origin remote/i,
  /^cannot push/i,
  /^git push failed$/i,
  /^repoRoot missing:/i,
  /^repoRoot must be empty/i,
  /^repoRoot is not a directory:/i,
  /^repoRoot check failed:/i,
  /^repoRoot readability check failed:/i,
  /^repoRoot required$/i,
  /^job args empty$/i,
  /^project_init requires/i,
  /^project_import requires/i,
  /^project_import forbids/i,
  /^project_init forbids/i,
]

export function sanitizeErrorMessage(err: unknown, fallback: string): string {
  const candidates: string[] = []

  if (err && typeof err === "object") {
    const data = (err as any).data
    const dataMessage = data && typeof data === "object" ? (data as any).message : null
    if (typeof dataMessage === "string") candidates.push(dataMessage)
  }

  if (err instanceof Error && typeof err.message === "string") candidates.push(err.message)
  candidates.push(String(err))

  for (const candidate of candidates) {
    const raw = candidate.trim()
    if (!raw) continue
    for (const re of SAFE_ERROR_PATTERNS) {
      if (re.test(raw)) return raw
    }
  }
  return fallback
}
