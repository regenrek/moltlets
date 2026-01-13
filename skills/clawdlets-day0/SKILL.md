---
name: clawdlets-day0
description: Day-0 onboarding automation for a fresh clawdlets project (Hetzner + Tailscale + Discord) using the existing clawdlets CLI. Use when you want a fully non-interactive golden path driven by a single local JSON file plus `.clawdlets/env`, up through `clawdlets bootstrap`.
---

Use this skill to run a deterministic “day 0” bring-up without hand-typing 20 commands.

Core idea:
- **Deploy creds** live in `.clawdlets/env` (gitignored): `HCLOUD_TOKEN` (+ optional `GITHUB_TOKEN`, `NIX_BIN`, `SOPS_AGE_KEY_FILE`)
- **Config** lives in `infra/configs/clawdlets.json` (committed)
- **Runtime secrets** live in `secrets/**` (committed, sops-encrypted)
- A single **local input file** `.clawdlets/day0.json` (gitignored, `0600`) drives setup.

## Workflow

1) Create project repo (optional)
- `clawdlets project init --dir <project-dir> --host <host>`
- `cd <project-dir>`

2) Set deploy creds once (local)
- `clawdlets env init`
- Edit `.clawdlets/env` and set `HCLOUD_TOKEN=...`

3) Create day0 input file (local)
- `node scripts/agent-bootstrap-server.mjs init`
- Edit `.clawdlets/day0.json` (contains plaintext secrets; keep private)

4) Apply (idempotent)
- `node scripts/agent-bootstrap-server.mjs apply`

If anything fails, fix the input and rerun `apply`. It only uses existing `clawdlets` commands.
