# Runbook (Day 0 / Day 2)

Goal: deterministic, deploy-only ops. Repo + `.clawlets/` are the only sources of truth.

## Repo guardrails (one-time)

Protect `main` before first real deploy:

```bash
./scripts/gh-protect-main.sh --linear-history
```

If/when you want required status checks, re-run with explicit contexts:

```bash
./scripts/gh-protect-main.sh --require-check "ci / node" --require-check "trufflehog"
```

## Day 0 (bootstrap)

1) Enter deterministic toolchain (optional): `devenv shell`
2) `export CLAWLETS_INTERACTIVE=1` (optional; forces prompts)
3) `clawlets secrets init`
4) `clawlets doctor --scope bootstrap`
5) `clawlets host set --ssh-exposure bootstrap`
6) `clawlets bootstrap`
7) Verify tailnet, then: `clawlets doctor --scope updates --strict`
8) Switch admin access to VPN + close public SSH:
   - `clawlets host set --target-host admin@<vpn-ip>`
   - `clawlets host set --ssh-exposure tailnet`
   - `clawlets server update apply --host <host> --target-host admin@<vpn-ip>`
   - `clawlets lockdown`
9) `clawlets server audit --target-host admin@<vpn-ip>`

## Day 2 (routine ops)

Apply updates:

- `clawlets server update apply --host <host> --target-host admin@<vpn-ip>`

Orchestrator (if cattle enabled):

- `systemctl status clf-orchestrator.socket`
- `systemctl status clf-orchestrator`
- bot-facing: `sudo -u bot-maren clf jobs list --json`

Secrets rotation:

- edit `secrets/hosts/<host>/*.yaml` → publish → `clawlets server update apply`

## Rollback (must exist before prod)

Normal rollback (SSH works):

- `sudo nixos-rebuild switch --rollback`
- reboot if needed

Emergency rollback (SSH broken):

- boot Hetzner rescue mode, mount the root FS, switch `/nix/var/nix/profiles/system` to an older generation, reboot

GC policy:

- keep multiple generations (don’t enable aggressive GC until you’ve tested rollback)

## GitHub inventory sync (optional)

If enabled (`services.clawdbotFleet.githubSync.enable = true`):

- `clawlets server github-sync status --target-host admin@<vpn-ip>`
- `clawlets server github-sync run --target-host admin@<vpn-ip> --bot <bot>`
- `clawlets server github-sync show --target-host admin@<vpn-ip> --bot <bot> --kind prs --lines 80`

## Ops snapshots (recommended)

If enabled (`services.clawdbotFleet.opsSnapshot.enable = true`):

- snapshots at `/var/lib/clawlets/ops/snapshots/latest.json`
- retention via `services.clawdbotFleet.opsSnapshot.keepDays/keepLast`
