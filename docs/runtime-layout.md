# Runtime layout (invariants)

## Pet host (fleet bots)

- `/srv/clawdbot/<bot>/` (default; see `services.clawdbotFleet.stateDirBase`)

Per-bot:

- `/srv/clawdbot/<bot>/workspace/`: agent workspace (seeded once if `documentsDir`/`workspace.seedDir` set)
- `/srv/clawdbot/<bot>/credentials/`: generated runtime creds (e.g. GitHub App token env, git-credentials)
- `/srv/clawdbot/<bot>/.codex/`: Codex CLI OAuth state (if Codex is enabled and you run device auth)

Host-wide secrets/tools:

- `/var/lib/sops-nix/key.txt`: host age key (installed via `nixos-anywhere --extra-files`)
- `/var/lib/clawlets/secrets/hosts/<host>/<secret>.yaml`: encrypted secrets (sops, out-of-store)
- `/run/secrets/**`: decrypted/rendered secrets (activation-time, tmpfs)
- `/etc/clawlets/tools.md`: generated inventory of installed tools (read-only)

## Pet host (`clf-orchestrator`)

- socket dir: `/run/clf/`
- API socket: `/run/clf/orchestrator.sock` (systemd socket `0660`, group `clf-bots`)
- state dir: `/var/lib/clf/orchestrator/`
- DB: `/var/lib/clf/orchestrator/state.sqlite` (SQLite WAL; contains job payloads/results + token hashes)
- cattle personas snapshot: `/etc/clf/cattle-personas/<name>/{SOUL.md,config.json}` (read-only)
- admin SSH keys (cattle debug): `/etc/clf/admin_authorized_keys` (read-only)

## Cattle VM (ephemeral)

- injected (disk):
  - task: `/var/lib/clawlets/cattle/task.json`
  - persona: `/var/lib/clawlets/cattle/persona/{SOUL.md,config.json}`
- runtime (tmpfs):
  - bootstrap token: `/run/clawlets/cattle/bootstrap.json` (deleted after first use)
  - env overrides (public): `/run/clawlets/cattle/env.public` (JSON)
  - secrets env: `/run/clawlets/cattle/env` (deleted when `autoShutdown=1`)
- workspace/logs:
  - `/var/lib/clawlets/cattle/workspace/` (gateway log, agent log, state)
  - result: `/var/lib/clawlets/cattle/result.json`

Invariant: bot processes should not write outside their `/srv/clawdbot/<bot>/` state dir (except Nix-managed paths like `/run/secrets/**`).
