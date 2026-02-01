# Cattle (ephemeral agents)

Goal: on-demand, ephemeral Clawdbot agent VMs on Hetzner Cloud (spawn → run task → destroy).

This is separate from “Pet” hosts (long-running fleet servers).

## Plugin

Install the cattle CLI plugin before running `clawlets cattle *` commands:

```
clawlets plugin add cattle
```

## Principles

- Hetzner-only.
- Tailnet-first: no public SSH by default.
- TTL everywhere: every cattle instance has an expiry.
- No secrets in Nix store.
- No provider secrets in Hetzner `user_data`:
  - cattle `user_data` contains only tailnet bootstrap + a one-time bootstrap token (short-lived).
  - runtime env (LLM keys, optional `GITHUB_TOKEN`) is fetched over tailnet from `clf-orchestrator`.

## Config

Enable + configure in `fleet/clawlets.json`:

```json
{
  "schemaVersion": 8,
  "cattle": {
    "enabled": true,
    "hetzner": {
      "image": "<image-id-or-name>",
      "serverType": "cx22",
      "location": "nbg1",
      "maxInstances": 10,
      "defaultTtl": "2h",
      "labels": { "managed-by": "clawlets" }
    },
    "defaults": { "autoShutdown": true, "callbackUrl": "" }
  }
}
```

Notes
- `cattle.hetzner.image` must point at a NixOS cattle image (see template output `clawlets-cattle-image`).
- Labels must be safe: ascii alnum + `._-`, max 63 chars, start/end alnum.

## Prereqs (operator)

- Run these commands on the **Pet host** (or in an SSH session on the Pet host).
  - `clawlets cattle *` talks to `clf-orchestrator` via Unix socket (`/run/clf/orchestrator.sock`).
- `clf-orchestrator` deployed + running:
  - `systemctl status clf-orchestrator`
  - `systemctl status clf-orchestrator.socket`
- Socket access:
  - operator user is in group `clf-bots` (or run as root).
- Tailscale installed + authenticated (used for SSH/logs): `tailscale status`

## Prereqs (project repo)

- Cattle image uploaded to Hetzner as a custom image.
- Host secrets include:
  - `tailscale_auth_key` (for the cattle VM to join tailnet)
    - Recommended: tag-scoped + short-lived/ephemeral preauth key; rotate regularly (it’s a tailnet-join capability).
    - Threat model: Hetzner `user_data` must be assumed readable by Hetzner project/API access; this key + the one-time bootstrap token live there briefly.
  - provider keys for the chosen model (wired via `fleet.secretEnv` → secret files under `secrets/hosts/<host>/`)
    - These are consumed by `clf-orchestrator` (cattle fetches them at runtime; not embedded in `user_data`).

Build + upload (Linux/CI recommended)
- build from the project repo flake:

```bash
nix build -L .#clawlets-cattle-image
```

- upload to Hetzner (example uses local path; adjust `--location`):

```bash
export HCLOUD_TOKEN=...
hcloud-upload-image upload --image-path ./result --architecture x86 --location nbg1 --labels managed-by=clawlets,role=cattle-image
```

Then set `fleet/clawlets.json`:
- `cattle.enabled=true`
- `cattle.hetzner.image="<image-id-or-name>"`

## Commands

```bash
clawlets cattle persona add --name rex
clawlets cattle persona list

clawlets cattle spawn --persona rex --task-file ./task.json --ttl 2h
clawlets cattle spawn --persona rex --task-file ./task.json --ttl 2h --with-github-token
clawlets cattle spawn --persona rex --task-file ./task.json --ttl 2h --dry-run
clawlets cattle list
clawlets cattle logs <name-or-id> --follow
clawlets cattle ssh <name-or-id>
clawlets cattle destroy <name-or-id>
clawlets cattle reap --dry-run
```

Notes
- `clawlets cattle spawn` enqueues a `cattle.spawn` job into `clf-orchestrator` (it does not talk to Hetzner directly).
- Bots should use `clf jobs ...` directly; see `docs/orchestrator.md`.

## Access model (recommended)

- Cattle uses Tailscale for SSH/logging (tailnet-only).
- `clawlets cattle ssh` resolves the Tailscale IP via `tailscale ip -4 <hostname>`.

Optional breakglass (not default): allow temporary public SSH from `adminCidr` (short TTL).

## Local state

- Local DB: `.clawlets/cattle/state.sqlite`
- Source of truth for lifecycle: Hetzner labels (`managed-by=clawlets,cattle=true`)

## Task format

The cattle VM reads `task.json` and runs the configured task once, then exits.

Treat `task.json` as non-secret input. Secrets come from sops-managed files in `secrets/` and are injected at runtime.

Notes
- `callbackUrl` is forced to `""` on enqueue (callbacks disabled until allowlist design).

## Persona registry

Project repo structure:

```
cattle/personas/
  rex/
    SOUL.md
    config.json
    skills/
    memory/
```

`clawlets cattle spawn --persona <name>` loads:
- `cattle/personas/<name>/SOUL.md`
- `cattle/personas/<name>/config.json` (`schemaVersion: 1`, `model.primary` optional)

Injected into the VM:
- `/var/lib/clawlets/cattle/persona/SOUL.md`
- `/var/lib/clawlets/cattle/persona/config.json`

Notes
- Cattle personas are separate from fleet bot workspaces (and clawdbot `IDENTITY.md`).
- Size limits enforced (cloud-init `user_data` max 32KiB): keep SOUL + config small.
- Model selection order: `--model` > `cattle/personas/<name>/config.json model.primary` > `hosts.<host>.agentModelPrimary`.

## Cost + safety controls

- `cattle.hetzner.maxInstances`: hard cap (spawn refuses beyond limit).
- `--ttl`: required on spawn (or `cattle.hetzner.defaultTtl`).
- `clawlets cattle reap`: deletes expired instances (use `--dry-run` first).

## Failure modes / debug

Common errors
- `cloud-init user_data too large`: reduce persona/task payload (user_data still carries task+persona + bootstrap bits; keep it small).
- `missing secretEnv mapping for <ENV_VAR>`: set `fleet.secretEnv.<ENV_VAR>=<secretName>` (or per-bot override) and create that secret file.
- `tailscale ip returned empty output`: the VM didn’t join tailnet (check `tailscale_auth_key`, then use Hetzner console for boot logs).

Debug commands
- list: `clawlets cattle list`
- logs: `clawlets cattle logs <id-or-name> --follow`
- ssh: `clawlets cattle ssh <id-or-name>`
- reap: `clawlets cattle reap --dry-run`
