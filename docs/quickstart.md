# Quickstart (CLI-first)

> 🚨🚨
> **Use at your own risk!** This project is under active development and not production-ready. You absolutely need to know what you're doing before deploying this. Misconfiguration can expose credentials, open security holes, or cause data loss.
>
> **Important:** clawlets infrastructure does not automatically mean your clawdbot setup is secure. A misconfigured clawdbot config can still expose your VPS. Read the [Security Guide](https://docs.clawd.bot/cli/security#security) carefully before proceeding.

Goal: provision a Hetzner VM + install NixOS + bring up Discord bots, with secrets in `secrets/` (sops-encrypted) and runtime state in `.clawlets/` (gitignored).

## Prereqs (local)

- Nix installed (`nix --version`)
- Node 22+ (for `clawlets`)
- SSH keypair (`~/.ssh/id_ed25519.pub` recommended)

## CLI commands

Run `clawlets --help` for full flags.

Install from local monorepo:

```bash
pnpm install
pnpm run clawlets -- --help
```

Use the pnpm wrapper for all commands (example): `pnpm run clawlets -- secrets init` == `clawlets secrets init`.

- `clawlets doctor --scope bootstrap`: bootstrap preflight (fails on missing).
- `clawlets doctor --scope updates --strict`: updates gate (fails on warn/missing).
- `clawlets secrets init`: generates operator keys + host key, writes encrypted secrets under `secrets/hosts/<host>/`, and generates `.clawlets/extra-files/<host>/...` for first install.
- `clawlets bootstrap`: runs provisioning + `nixos-anywhere` install (prints target IPv4; clears stale `known_hosts`).
- `clawlets infra apply`: provisioning apply only (driven by `fleet/clawlets.json`).
- `clawlets lockdown`: reconcile to tailnet-only SSH (provisioning only).
- `clawlets server <cmd>`: run server-side operations over SSH (`status`, `logs`, `restart`, `update`).

## Recommended workflow (new host)

0) (optional) create a fresh project repo:
```bash
export CLAWLETS_INTERACTIVE=1
clawlets project init --dir ./clawlets-myproject
cd ./clawlets-myproject
```

Note: `project init` already includes `fleet/clawlets.json`. Don’t run `clawlets config init` unless you want to reset it (`--force`).
Template source defaults to the pinned config in `config/template-source.json` (repo + path + 40-hex ref).
Override with `--template`, `--template-path`, or `--template-ref` (or env `CLAWLETS_TEMPLATE_*`).

0.5) Optional: private cache auth (Garnix/Attic/Harmonia/etc):
- enable cache netrc in config: `clawlets host set --cache-netrc-enable true --cache-netrc-secret-name garnix_netrc`
- add `secrets/hosts/<host>/garnix_netrc.yaml` with your netrc credentials

1) Configure fleet + host (CLI-first):
- configure channels (Discord/Telegram/Slack/WhatsApp) in each bot’s `fleet.bots.<bot>.clawdbot` (recommended via web UI: Setup → Bots → Integrations)
- add bots: `clawlets bot add --bot <id>` (repeat)
- host basics:
  - add SSH key: `clawlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub`
  - pin host key (for CI deploy): `clawlets host set --add-ssh-known-host "<host> ssh-ed25519 AAAA..."`
  - set disk device: `clawlets host set --disk-device /dev/sda`
  - enable fleet: `clawlets host set --enable true`
  - tailnet defaults to Tailscale (change via `clawlets host set --tailnet none|tailscale` if needed)
  - set SSH exposure for bootstrap: `clawlets host set --ssh-exposure bootstrap`

Canonical config lives in `fleet/clawlets.json` (don’t edit Nix files directly).

2) Create secrets + preflight:
```bash
clawlets secrets init
clawlets doctor --scope bootstrap
```

Non-interactive: keep inputs in `.clawlets/secrets.json` and run `clawlets secrets init --from-json .clawlets/secrets.json` (if the file is missing, `secrets init` will write a template and exit).

LLM API keys are provided via `secrets.<secretName>` in that JSON (e.g. `secrets.z_ai_api_key`) and wired to env via `fleet.secretEnv` (e.g. `fleet.secretEnv.ZAI_API_KEY = "z_ai_api_key"`).

3) Provision + install:
```bash
clawlets bootstrap
```

Optional image-based bootstrap: see `docs/image-based-provisioning.md` and run:

```bash
clawlets image build --host <host>
clawlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
clawlets bootstrap --mode image
```

4) Verify access:
- SSH (when `sshExposure.mode=bootstrap|public`): `ssh admin@<ipv4>`
- Console: `admin` login should work (sudo password exists; SSH stays key-only)

5) Lock down after VPN/tailnet works:

> 🚨 **CRITICAL:** Lockdown is mandatory! Without it, your server remains publicly accessible via SSH. Run `clawlets lockdown` as soon as your VPN/tailnet connection is confirmed working. Skipping this step leaves your server exposed to the internet.

```bash
clawlets host set --target-host admin@<tailscale-ip>
clawlets host set --ssh-exposure tailnet
clawlets server update apply --host <host>
clawlets lockdown
```

6) Apply updates (signed desired state):

- Publish the new signed manifest + `latest.json` pointer (CI workflow `updates: publish`).
- Hosts apply on a timer, or trigger immediately:

```bash
clawlets server update apply --host <host>
```

Note: building NixOS system artifacts requires Linux. On macOS, use CI (`updates-publish.yml`) or a Linux builder.

## Server checks

```bash
clawlets server status --target-host admin@<ipv4>
clawlets server logs --target-host admin@<ipv4> --unit clawdbot-maren.service --since 15m --follow
```

## Common follow-ups

- Change tokens/passwords: edit `secrets/hosts/<host>/*.yaml` with sops, publish, then apply updates.
- Add a bot: `clawlets bot add --bot <id>` → re-run `clawlets secrets init` → publish → apply updates.
- Add/enable a skill:
  - add it to `fleet/bundled-skills.json` (if bundled)
  - allow it per-bot via canonical config:
    - `clawlets config set --path fleet.bots.<bot>.profile.skills.allowBundled --value-json '["github","brave-search"]'`
  - if it needs secrets: add `secrets/hosts/<host>/<secret>.yaml`, then publish + apply updates
- Add another operator machine: add their age public key to `secrets/.sops.yaml` recipients for that host and re-encrypt.
