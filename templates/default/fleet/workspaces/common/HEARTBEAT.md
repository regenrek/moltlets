# HEARTBEAT

Operator cadence (suggested):

1) `clawlets doctor --scope repo`
2) `clawlets doctor --scope updates --strict` (before live ops)
3) For each host: `clawlets server audit --target-host <host>`
3a) If `services.clawdbotFleet.githubSync.enable = true`: check `<workspace>/memory/github/{prs,issues}.md`
3b) If `services.clawdbotFleet.opsSnapshot.enable = true`: check `/var/lib/clawlets/ops/snapshots/latest.json`
4) If degraded: capture logs (`clawlets server logs ...`), then codify + rebuild pinned (`--rev <sha|HEAD>`)

Rule: if a fix can’t be expressed as repo + `.clawlets/` change, treat it as breakglass and follow clawlets repo `apps/docs/content/docs/security/ops-invariants.mdx`.
