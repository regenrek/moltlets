# POC (acceptance criteria)

Goal: prove clawlets can provision + operate a single Hetzner host end-to-end with **no** manual secret handling and **no** drift.

## Acceptance criteria (must pass)

### Provision + install

- `fleet/clawlets.json` exists (schemaVersion 12) and is the single source of truth for fleet + hosts.
- `CLAWLETS_INTERACTIVE=1 clawlets secrets init` created/updated:
  - `secrets/.sops.yaml`
  - `secrets/keys/hosts/<host>.agekey.yaml` (encrypted host age key)
  - `secrets/hosts/<host>/*.yaml` (one secret per file; encrypted)
  - `.clawlets/keys/operators/<operator>.agekey` (local operator key; never committed)
  - `.clawlets/extra-files/<host>/var/lib/sops-nix/key.txt`
  - `.clawlets/extra-files/<host>/var/lib/clawlets/secrets/hosts/<host>/*.yaml`
- `clawlets doctor --scope bootstrap` passes.
- `clawlets bootstrap` succeeds.

### Post-install validation

- SSH works: `ssh admin@<ipv4>` (or your SSH alias).
- Secrets are out-of-store:
  - encrypted secrets exist at `/var/lib/clawlets/secrets/hosts/<host>/`
  - decrypted runtime material exists under `/run/secrets/`
- Services are healthy:
  - `systemctl status 'clawdbot-*' --no-pager`
  - expected bots are running (per `fleet/clawlets.json`).
- Discord routing works (bots respond in expected channels).

### Lockdown (no public SSH)

- Tailnet works (WireGuard or Tailscale).
- `clawlets doctor --scope updates --strict` passes.
- `clawlets host set --target-host admin@<tail-ip>` + `clawlets host set --ssh-exposure tailnet` then `clawlets lockdown` succeeds.
- Public SSH closed:
  - Hetzner firewall removes TCP/22 from internet
  - NixOS only allows SSH via `tailscale0` when `sshExposure.mode=tailnet`

### Day-2 ops

- Apply updates: `clawlets server update apply --host <host>` works.
- Rotate a Discord token:
  - edit `secrets/hosts/<host>/discord_token_<bot>.yaml` with `sops`
  - `clawlets secrets sync`
  - deploy pinned; bot uses new token
- Roll back by deploying an older commit SHA (pinned) and confirm bot still runs.

## Non-goals

- Multi-host fleet orchestration
- CI-driven cache/signing infra (Attic)
