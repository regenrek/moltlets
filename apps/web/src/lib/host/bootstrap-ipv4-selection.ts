export type BootstrapRunCandidate = {
  kind?: string | null
  status?: string | null
}

export function orderBootstrapRunsForIpv4<R extends BootstrapRunCandidate>(runs: readonly R[]): R[] {
  const succeeded: R[] = []
  const running: R[] = []
  const queued: R[] = []
  const fallback: R[] = []

  for (const run of runs) {
    if (String(run.kind || "") !== "bootstrap") continue
    const status = String(run.status || "")
    if (status === "succeeded") {
      succeeded.push(run)
      continue
    }
    if (status === "running") {
      running.push(run)
      continue
    }
    if (status === "queued") {
      queued.push(run)
      continue
    }
    fallback.push(run)
  }

  return [...succeeded, ...running, ...queued, ...fallback]
}
