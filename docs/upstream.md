# Upstream tracking (nix-clawdbot)

`nix-clawdbot` is pinned in the **project repo** (from `clawlets-template`), not this CLI repo.

## Update procedure (project repo)

1) Bump the input locally:

```bash
nix flake lock --update-input nix-clawdbot
```

2) Apply updates on a staging host (pinned):

```bash
clawlets release manifest build --host <host> --channel staging --system x86_64-linux --release-id <releaseId> --out deploy/<host>/staging/<releaseId>.json
clawlets release manifest sign --in deploy/<host>/staging/<releaseId>.json
clawlets server update apply --host <host>
```

3) Verify:
- gateway starts cleanly
- bot configs render
- no schema errors in logs
- discord routing works

## What to watch for

- Config schema changes (new/removed keys)
- Gateway flags or startup behavior
- Secrets/env expectations
- Skills/plugin wiring compatibility
