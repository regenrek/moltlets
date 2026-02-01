# Clawlets Architecture

This document describes the end-to-end lifecycle of a Clawlets project, from initialization through ongoing maintenance.

## Repo layers + secret boundaries

- **clawlets (CLI repo):** `clawlets` + `clf` + docs (no project secrets).
- **clawlets-template:** scaffold + workflows used by `project init`.
- **Project repo:** `flake.nix`, `fleet/`, `secrets/`, `cattle/personas/` (public-safe).
- **Runtime (`.clawlets/`):** gitignored state + keys + provisioning artifacts.

Rules of thumb:
- `fleet/clawlets.json` and `fleet/workspaces/**` (documentsDir/includes) must not contain secrets.
- Secrets live only in `secrets/` (sops-encrypted) and `.clawlets/` (runtime).

## Defaults worth knowing

- Template defaults `sshExposure.mode=bootstrap` (public SSH only for day-0).
- `cache.netrc.enable` defaults to `false` (opt-in).
- `provisioning.adminCidr` must be a CIDR; world-open requires `adminCidrAllowWorldOpen=true`.

## E2E Lifecycle Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                           CLAWLETS E2E LIFECYCLE DIAGRAM                                            ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: PROJECT INITIALIZATION (clawlets project init)                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│   Developer                                                                                          │
│      │                                                                                               │
│      │  clawlets project init --dir ./my-fleet                                                      │
│      ▼                                                                                               │
│  ┌────────────────┐       ┌──────────────────────────┐       ┌─────────────────────────────┐         │
│  │  clawlets     │──────▶│  clawlets-template      │──────▶│  New Project Created        │         │
│  │  CLI           │ giget │  (templates/default/)    │       │                             │         │
│  └────────────────┘       └──────────────────────────┘       │  my-fleet/                  │         │
│                                                              │  ├── flake.nix              │         │
│   Inputs:                                                    │  ├── fleet/clawlets.json   │         │
│   - template repo (regenrek/clawlets-template)              │  ├── secrets/               │         │
│   - host name                                                │  ├── .clawlets/            │         │
│                                                              │  ├── cattle/personas/       │         │
│                                                              │  └── .github/workflows/     │         │
│                                                              └─────────────────────────────┘         │
│                                                                                                      │
│   + Installs git hooks (block plaintext secrets, verify sops encryption)                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ Project scaffolded
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: DAY0 BOOTSTRAP (First-Time Provisioning)                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: ENVIRONMENT SETUP                                                                     │   │
│  │ ─────────────────────────                                                                     │   │
│  │   clawlets env init  ──▶  .clawlets/env (HCLOUD_TOKEN)                                      │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: FLEET & HOST CONFIGURATION                                                            │   │
│  │ ─────────────────────────────────────                                                         │   │
│  │   clawlets fleet set --guild-id <id>                                                         │   │
│  │   clawlets bot add --bot <id>                              ┌─────────────────────────┐       │   │
│  │   clawlets host add --host myhost           ──────────────▶│ fleet/clawlets.json    │       │   │
│  │   clawlets host set --host myhost \                        │ (canonical config)      │       │   │
│  │       --enable true --ssh-exposure bootstrap \              └─────────────────────────┘       │   │
│  │       --admin-cidr <ip>/32 --ssh-pubkey-file ~/.ssh/id.pub                                    │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: SECRETS INITIALIZATION                                                                │   │
│  │ ─────────────────────────────────                                                             │   │
│  │   clawlets secrets init --interactive                                                        │   │
│  │                   │                                                                           │   │
│  │                   ├──▶ secrets/.sops.yaml (encryption rules)                                  │   │
│  │                   ├──▶ secrets/hosts/<host>/age_key.yaml                                      │   │
│  │                   ├──▶ secrets/hosts/<host>/discord_token_*.yaml                              │   │
│  │                   ├──▶ secrets/hosts/<host>/tailscale_authkey.yaml                            │   │
│  │                   └──▶ .clawlets/extra-files/<host>/ (injection payload)                     │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: PRE-FLIGHT CHECK                                                                      │   │
│  │ ────────────────────────                                                                      │   │
│  │   clawlets doctor --scope bootstrap --strict                                                 │   │
│  │                   │                                                                           │   │
│  │                   └──▶ Validates: secrets, config, Nix flake, SSH keys                        │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: BOOTSTRAP (Provision + Install)                                                       │   │
│  │ ───────────────────────────────────────                                                       │   │
│  │   clawlets bootstrap --host myhost                                                           │   │
│  │                   │                                                                           │   │
│  │                   ├──▶ OpenTofu Apply ──▶ Hetzner VM Created ──▶ Public IP                    │   │
│  │                   │                                                                           │   │
│  │                   └──▶ nixos-anywhere ──▶ NixOS Installed ──▶ Secrets Injected                │   │
│  │                                                        │                                      │   │
│  │                                                        ▼                                      │   │
│  │                                              ┌─────────────────────┐                          │   │
│  │                                              │  HETZNER CLOUD      │                          │   │
│  │                                              │  ┌───────────────┐  │                          │   │
│  │                                              │  │  NixOS VM     │  │                          │   │
│  │                                              │  │  + clawdbot   │  │                          │   │
│  │                                              │  │  + Tailscale  │  │                          │   │
│  │                                              │  └───────────────┘  │                          │   │
│  │                                              └─────────────────────┘                          │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                              │                                                       │
│                                              ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: LOCKDOWN (Secure to Tailnet)                                                          │   │
│  │ ───────────────────────────────────                                                           │   │
│  │   clawlets host set --target-host admin@<tailscale-ip>                                       │   │
│  │   clawlets host set --ssh-exposure tailnet                                                   │   │
│  │   clawlets lockdown --host myhost                                                            │   │
│  │                   │                                                                           │   │
│  │                   └──▶ Closes public SSH, Tailnet-only access                                 │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│   OUTPUT: Running NixOS VM on Hetzner, reachable only via Tailnet                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                    │
                                                    │ Server provisioned & secured
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: DAY MAINTENANCE (Ongoing Operations)                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              GITOPS CI/CD PIPELINE                                              │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  Developer pushes to main                                                                       │ │
│  │         │                                                                                       │ │
│  │         ▼                                                                                       │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │  │ updates-publish.yml (GitHub Actions)                                                      │   │ │
│  │  │ ──────────────────────────────────────                                                    │   │ │
│  │  │   1. nix eval .#packages.x86_64-linux."<host>-system".outPath  (Store path)              │   │ │
│  │  │   2. clawlets release manifest build --host <host> --channel <channel> --release-id <n>  │   │ │
│  │  │   3. minisign -S  (Sign with MINISIGN_PRIVATE_KEY)                                        │   │ │
│  │  │   4. Commit to gh-pages branch (GitHub Pages):                                            │   │ │
│  │  │        deploy/<host>/<channel>/latest.json                                                │   │ │
│  │  │        deploy/<host>/<channel>/<releaseId>.json                                           │   │ │
│  │  └────────────────────────────────────────────────────────────────────────────────────────┬─┘   │ │
│  │                                                                                           │     │ │
│  │                                                                                           ▼     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │  │ operator apply-now (optional)                                                            │   │ │
│  │  │ ─────────────────────────────                                                            │   │ │
│  │  │   clawlets server update apply --host <host> ───────────────▶ NixOS Host                 │   │ │
│  │  └──────────────────────────────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              SCHEDULED AUTO-UPDATES                                             │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  ┌────────────────────────────────┐         ┌────────────────────────────────────────────────┐  │ │
│  │  │ bump-nix-clawdbot.yml          │         │                                                │  │ │
│  │  │ (Cron: every 6 hours)          │ ──────▶ │  Creates PR to update flake.lock               │  │ │
│  │  │                                │         │  (pulls latest nix-clawdbot)                   │  │ │
│  │  └────────────────────────────────┘         └────────────────────────────────────────────────┘  │ │
│  │                                                          │                                      │ │
│  │                                                          ▼                                      │ │
│  │                                              PR merged ──▶ triggers updates-publish.yml         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              CATTLE (EPHEMERAL VMs)                                             │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │   ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │   │ cattle-image.yml (Build once)                                                            │   │ │
│  │   │ ─────────────────────────────                                                            │   │ │
│  │   │   1. nix build .#cattle-x86_64-linux-hcloud-image                                        │   │ │
│  │   │   2. hcloud-upload-image (Upload to Hetzner)                                             │   │ │
│  │   │   3. Output: cattle-image.json (image ID)                                                │   │ │
│  │   └──────────────────────────────────────────────────────────────────────────────────────┬──┘   │ │
│  │                                                                                          │      │ │
│  │                                                                                          ▼      │ │
│  │   ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │ │
│  │   │ Runtime Cattle Operations (via clf-orchestrator on host)                                 │   │ │
│  │   │ ─────────────────────────────────────────────────────────                                │   │ │
│  │   │                                                                                          │   │ │
│  │   │   clawlets cattle spawn --persona rex --task-file ./task.json --ttl 2h                  │   │ │
│  │   │         │                                                                                │   │ │
│  │   │         ▼                                                                                │   │ │
│  │   │   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐                          │   │ │
│  │   │   │ Orchestrator│──────▶ │ Hetzner API │──────▶ │ Cattle VM   │ (ephemeral NixOS)        │   │ │
│  │   │   │ (on host)   │        │ (spawn VM)  │        │ runs task   │                          │   │ │
│  │   │   └─────────────┘        └─────────────┘        └──────┬──────┘                          │   │ │
│  │   │                                                        │                                 │   │ │
│  │   │                                                        ▼                                 │   │ │
│  │   │   clawlets cattle list           (list active VMs)                                      │   │ │
│  │   │   clawlets cattle logs <id>      (stream logs)                                          │   │ │
│  │   │   clawlets cattle reap           (cleanup expired VMs)  ◀─── TTL reached               │   │ │
│  │   └─────────────────────────────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              OPERATOR TASKS                                                     │ │
│  │  ─────────────────────────────────────────────────────────────────────────────────────────────  │ │
│  │                                                                                                 │ │
│  │  ┌──────────────────────────────┐      ┌──────────────────────────────┐                         │ │
│  │  │ Health Checks                │      │ Secrets Management           │                         │ │
│  │  │ ─────────────                │      │ ──────────────────           │                         │ │
│  │  │ clawlets doctor --scope repo│      │ sops edit secrets/...yaml    │                         │ │
│  │  │ clawlets doctor --scope     │      │ clawlets secrets sync       │                         │ │
│  │  │   updates --strict           │      │ clawlets server update apply│                         │ │
│  │  │ clawlets server audit       │      └──────────────────────────────┘                         │ │
│  │  │ clawlets server logs --unit │                                                               │ │
│  │  │   clawdbot-*.service --follow│      ┌──────────────────────────────┐                         │ │
│  │  └──────────────────────────────┘      │ Add Bots/Features            │                         │ │
│  │                                        │ ─────────────────            │                         │ │
│  │                                        │ clawlets bot add --bot <id> │                         │ │
│  │                                        │ clawlets secrets init       │                         │ │
│  │                                        │ clawlets server update apply│                         │ │
│  │                                        └──────────────────────────────┘                         │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Relationships

```
╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                   COMPONENT RELATIONSHIPS                                            ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                      ║
║    ┌────────────────────┐              ┌─────────────────────┐              ┌──────────────────────┐ ║
║    │  clawlets CLI     │              │  clawlets-template │              │  User Project        │ ║
║    │  (packages/cli/)   │─────────────▶│  (templates/default)│─────────────▶│  (my-fleet/)         │ ║
║    │                    │   init       │                     │   scaffold   │                      │ ║
║    └────────────────────┘              └─────────────────────┘              └──────────────────────┘ ║
║             │                                                                         │              ║
║             │ bootstrap/deploy                                                        │ push         ║
║             ▼                                                                         ▼              ║
║    ┌────────────────────┐              ┌─────────────────────┐              ┌──────────────────────┐ ║
║    │  Hetzner Cloud     │◀─────────────│  GitHub Actions     │◀─────────────│  GitHub Repo         │ ║
║    │  (VMs)             │   deploy     │  (CI/CD)            │   trigger    │  (GitOps)            │ ║
║    └────────────────────┘              └─────────────────────┘              └──────────────────────┘ ║
║             ▲                                    │                                                   ║
║             │                                    │ publish                                           ║
║             │ nix copy                           ▼                                                   ║
║    ┌────────────────────┐              ┌─────────────────────┐                                       ║
║    │  Garnix Cache      │◀─────────────│  GitHub Pages       │                                       ║
║    │  (nix store)       │   build      │  (manifests)        │                                       ║
║    └────────────────────┘              └─────────────────────┘                                       ║
║                                                                                                      ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

## Key Files Reference

| Category | File | Purpose |
|----------|------|---------|
| **Configuration** | `fleet/clawlets.json` | Central fleet configuration (hosts, bots, secrets mapping) |
| | `flake.nix` / `flake.lock` | NixOS configurations for hosts and cattle images |
| | `.clawlets/env` | Local deploy credentials (gitignored) |
| | `cattle/personas/<name>/` | Cattle persona registry |
| **Secrets** | `secrets/.sops.yaml` | SOPS encryption rules |
| | `secrets/hosts/<host>/*.yaml` | Encrypted secrets per host |
| | `.clawlets/extra-files/` | nixos-anywhere injection payload |
| **Workflows** | `updates-publish.yml` | Builds and signs release manifests + publishes secrets bundles |
| | `deploy.yml` | Deploys manifests to hosts via Tailnet |
| | `bump-nix-clawdbot.yml` | Auto-updates nix-clawdbot dependency |
| | `cattle-image.yml` | Builds and uploads cattle VM image |
| **Manifests** | `deploy/<host>/<channel>/<releaseId>.json` | Pinned desired-state manifest |
| | `deploy/<host>/<channel>/latest.json` | Pointer on GitHub Pages |
| | `deploy/<host>/<channel>/secrets/<digest>.tgz` | Encrypted secrets bundle (sops `.yaml`) |
| | `cattle-image.json` | Cattle image ID artifact |
| **Playbooks** | `AGENT-BOOTSTRAP-SERVER.md` | Interactive day0 bootstrap guide |
| | `AGENT-BOOTSTRAP-SERVER-AUTO.md` | Non-interactive day0 bootstrap |
| | `AGENT-CATTLE-SPAWN.md` | Ephemeral cattle VM spawning guide |
| | `HEARTBEAT.md` | Operator health check cadence |

## Phase Summary

| Phase | Purpose | Key Commands | Output |
|-------|---------|--------------|--------|
| **1. Init** | Scaffold project from template | `clawlets project init` | Project repo with flake, config, secrets structure |
| **2. Day0** | First-time provisioning | `env init` → `host set` → `secrets init` → `bootstrap` → `lockdown` | Running NixOS VM on Hetzner, secured via Tailnet |
| **3. Day** | Ongoing operations | GitOps (push → build → deploy), cattle spawn/reap, secrets rotation | Continuous deployment, ephemeral task VMs |

## Flow Summary

The lifecycle follows this pattern:

```
Template → Init → Day0 Bootstrap → Lockdown → GitOps CI/CD loop
                                                    ↓
                                            Cattle VMs (on demand)
```

1. **Template** (`clawlets-template`) provides the project scaffold
2. **Init** creates a new project with all necessary files and git hooks
3. **Day0 Bootstrap** provisions infrastructure on Hetzner and installs NixOS
4. **Lockdown** secures the server to Tailnet-only access
5. **GitOps CI/CD** handles continuous deployment on push to main
6. **Cattle VMs** spawn ephemeral task runners as needed
