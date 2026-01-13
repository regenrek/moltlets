# AGENT-BOOTSTRAP-SERVER

Goal: non-interactive day-0 bringup for a fresh clawdlets fleet repo (Hetzner + Tailscale + Discord), using the existing `clawdlets` CLI.

Canonical inputs
- Deploy creds (local-only): `.clawdlets/env`
  - `HCLOUD_TOKEN` required (Hetzner API)
  - `GITHUB_TOKEN` optional (private base flake)
  - `NIX_BIN`, `SOPS_AGE_KEY_FILE` optional
- Config (committed): `infra/configs/clawdlets.json`
- Runtime secrets (committed, encrypted): `secrets/**` (sops+age)
- Day0 input (local-only, plaintext): `.clawdlets/day0.json` (0600; never commit)

## Fast path

1) Scaffold (optional)
- `clawdlets project init --dir <project-dir> --host <host>`
- `cd <project-dir>`

2) Set deploy creds once
- `clawdlets env init`
- edit `.clawdlets/env` and set `HCLOUD_TOKEN=...`

3) Create day0 input template
- `node scripts/agent-bootstrap-server.mjs init`
- edit `.clawdlets/day0.json` and fill:
  - `fleet.guildId`
  - `secretsInit.adminPasswordHash` (YESCRYPT hash)
  - `secretsInit.tailscaleAuthKey` (if tailnet=tailscale)
  - `secretsInit.discordTokens.<bot>` for each bot
  - `secretsInit.secrets.<secretName>` for LLM API keys referenced by `fleet.envSecrets`

4) Apply (idempotent)
- `node scripts/agent-bootstrap-server.mjs apply`

5) After bootstrap
- join tailnet, then set:
  - `clawdlets host set --target-host admin@<tailscale-ip>`
- then:
  - `clawdlets lockdown`

## Notes
- `day0.json` contains plaintext secrets. Keep it out of git (lives under `.clawdlets/`).
- The script pipes JSON to `clawdlets secrets init --from-json - --yes` (no heredocs / no `yes | ...`).

