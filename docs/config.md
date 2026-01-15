# Config (`fleet/clawdlets.json`)

Single source of truth for fleet + host settings.

This file is **committed to git**. Secrets are not stored here (see `docs/secrets.md`).

## Related dirs

- `fleet/clawdlets.json`: canonical config (validated)
- `secrets/`: canonical encrypted secrets (sops + age; safe to commit)
- `.clawdlets/`: local runtime dir (gitignored)
  - local operator age keys (`.clawdlets/keys/operators/`)
  - `nixos-anywhere --extra-files` payload (`.clawdlets/extra-files/<host>/...`)

## Schema overview

Top-level:

- `schemaVersion`: currently `5`
- `defaultHost` (optional): used when `--host` is omitted
- `baseFlake` (optional): flake URI for remote builds (e.g. `github:<owner>/<repo>`)
  - if empty, CLI falls back to `git remote origin` (recommended)
- `fleet.*`: bots + routing/skills overrides
- `fleet.envSecrets`: env var -> sops secret name (used for LLM API keys + other secret env)
- `hosts.<host>`: host entries keyed by host name

Host entry (`hosts.<host>`):

- `enable`: whether fleet services should run
- `diskDevice`: passed into the disko module (required for install)
- `sshAuthorizedKeys`: admin SSH public keys (key-only; no passwords over SSH)
- `flakeHost` (optional): nixosConfiguration output name override
- `targetHost` (optional): SSH target for server ops (ssh config alias or `user@host`)
- `hetzner.serverType`: e.g. `cx43`
- `opentofu.adminCidr`: CIDR allowed to SSH during bootstrap (e.g. `203.0.113.10/32`)
- `opentofu.sshPubkeyFile`: local path to `.pub` used for provisioning
- `sshExposure.mode`: `tailnet|bootstrap|public` (single SSH exposure policy)
- `tailnet.mode`: `tailscale` or `none` (tailscale mode opens UDP/41641 at the provider firewall for direct tailnet connectivity)

## Example

```json
{
  "schemaVersion": 5,
  "defaultHost": "clawdbot-fleet-host",
  "baseFlake": "",
  "fleet": {
    "guildId": "",
    "envSecrets": { "ZAI_API_KEY": "z_ai_api_key", "Z_AI_API_KEY": "z_ai_api_key" },
    "bots": ["maren", "sonja", "gunnar", "melinda"],
    "botOverrides": {},
    "routingOverrides": {},
    "codex": { "enable": false, "bots": [] },
    "backups": { "restic": { "enable": false, "repository": "" } }
  },
  "hosts": {
    "clawdbot-fleet-host": {
      "enable": false,
      "diskDevice": "/dev/disk/by-id/CHANGE_ME",
      "sshAuthorizedKeys": [],
      "flakeHost": "",
      "hetzner": { "serverType": "cx43" },
      "opentofu": { "adminCidr": "", "sshPubkeyFile": "~/.ssh/id_ed25519.pub" },
      "sshExposure": { "mode": "tailnet" },
      "tailnet": { "mode": "tailscale" },
      "agentModelPrimary": "zai/glm-4.7"
    }
  }
}
```
